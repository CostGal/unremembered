import zipfile, pickle, numpy as np, collections
DT={'FloatStorage':np.float32,'HalfStorage':np.float16,'DoubleStorage':np.float64,'LongStorage':np.int64,'IntStorage':np.int32}
def load(path):
    z=zipfile.ZipFile(path); names=z.namelist()
    pkl=[n for n in names if n.endswith('data.pkl')][0]; prefix=pkl[:-len('data.pkl')]
    class Stor:
        def __init__(s,dtype,key): s.dtype=dtype; s.key=key
    def rebuild(storage, offset, size, stride, *a):
        raw=np.frombuffer(z.read(prefix+'data/'+storage.key), dtype=storage.dtype)
        if len(size)==0: return raw[offset]
        itemsize=raw.itemsize
        arr=np.lib.stride_tricks.as_strided(raw[offset:], shape=size, strides=[s*itemsize for s in stride])
        return np.array(arr)
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if name=='_rebuild_tensor_v2': return rebuild
            if name in DT: return name
            if name=='OrderedDict': return collections.OrderedDict
            if mod.startswith('torch'): return lambda *a,**k: None
            return super().find_class(mod,name)
        def persistent_load(self, pid):
            typ, stype, key, loc, n = pid
            return Stor(DT[stype] if isinstance(stype,str) else np.float32, key)
    return U(z.open(pkl)).load()
