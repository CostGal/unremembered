import numpy as np, onnx
from onnx import helper, TensorProto, numpy_helper
from load_pth import load
d=load('animev3.pth')['params']
nodes=[]; inits=[]; cur='x'
convs=[i for i in range(0,35,2)]
for i in range(35):
    wk=f'body.{i}.weight'
    if wk not in d: continue
    w=d[wk]
    if w.ndim==4:
        inits+= [numpy_helper.from_array(w.astype(np.float32),f'w{i}'), numpy_helper.from_array(d[f'body.{i}.bias'].astype(np.float32),f'b{i}')]
        nodes.append(helper.make_node('Conv',[cur,f'w{i}',f'b{i}'],[f'c{i}'],pads=[1,1,1,1],kernel_shape=[3,3])); cur=f'c{i}'
    else:
        inits.append(numpy_helper.from_array(w.reshape(-1,1,1).astype(np.float32),f'p{i}'))
        nodes.append(helper.make_node('PRelu',[cur,f'p{i}'],[f'r{i}'])); cur=f'r{i}'
nodes.append(helper.make_node('DepthToSpace',[cur],['up'],blocksize=4,mode='CRD'))
inits.append(numpy_helper.from_array(np.array([1,1,4,4],np.float32),'scales'))
nodes.append(helper.make_node('Resize',['x','','scales'],['base'],mode='nearest'))
nodes.append(helper.make_node('Add',['up','base'],['y']))
g=helper.make_graph(nodes,'srvgg',[helper.make_tensor_value_info('x',TensorProto.FLOAT,[1,3,None,None])],[helper.make_tensor_value_info('y',TensorProto.FLOAT,[1,3,None,None])],inits)
m=helper.make_model(g,opset_imports=[helper.make_opsetid('',13)]); m.ir_version=8
onnx.checker.check_model(m); onnx.save(m,'animev3.onnx'); print('ok', len(nodes))
