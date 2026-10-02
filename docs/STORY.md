# Unremembered — Story Bible v2 (cohesion pass 2/10)

Dialogue lines are open until **Thu 1/10**. Everything else below is locked for the jam. Changes go to Post-jam issues.

## World
- **Veyra**, capital of a hextech kingdom: rune engines, lanterns, clockwork, towers. No guns, cars or phones.
- **The Reliquary:** a crystal-and-rune engine under the city that recorded every citizen's memories, so that no one would ever be forgotten.
- **King Aurelian** built it. He ended the forty-year Long War in one winter, at the cost of his army, his brother and his youth.
- The new council needed someone to blame for the dead. They branded him the butcher of the war he ended and sentenced him to **the Unwriting**: through the Reliquary, every memory of him was torn from every mind. Even his daughter forgot him.
- **Twenty years** of exile in the ruins beyond the wall. He once came back in secret to see his daughter; she looked at him and saw a stranger. Grief became hatred.
- He returned to the Reliquary, the place that held his erased name, and turned the engine inside out. That night is **the Hush**.
- The game starts **seven years after the Hush**.

## After the Hush
- Every night, one person is **unremembered**. They still live, but no one can recall them. They are called the **Forgotten**.
- Aurelian turns what is taken into monsters: the **Hollows**.
- Steel passes through a Hollow like smoke. **Only a memory can wound a memory.** So people learned to burn their own memories: **Echo**.

## Echo — rules
1. **Weight = power.** Trivial memories give sparks; precious ones give storms.
2. What you burn is gone **for you**. Others still remember it. Only Aurelian can erase something from everyone.
3. **The present makes new sparks.** Every moment of a fight becomes a fresh memory, which is why Echo refills in battle.
4. Burn everything and you become a **Blank**: an empty shell that attacks the living.
5. Your technique is shaped by your strongest memory. (Dov's Anchor is Rhea as a small child on his shoulders at the lantern festival.)
6. **Hollows are made of what was taken.** Breaking one lets pieces drift free, and sometimes they find their way home. This is the in-fiction reason for the "A memory returns" reward. The Hollows in Chapter 1 are made of Dov: Nala hisses at the dust because she knows it.
- **Keepsakes:** precious memories a fighter holds in reserve. Burning one gives a flood of Echo.
- **Recollection:** the ultimate. The user pulls the fight into one of their memories.

## Characters (demo)
- **Rhea:** courier, early 20s, short white hair, long dark navy coat, messenger bag, collapsible baton. Teal Echo. Fast, damage. Narrator of the opening.
- **Dov:** Rhea's brother, **Forgotten** (erased last night). Tall and broad, worn work jacket, bandaged fists, short dark hair. Amber Echo. Tank and support.
- **Nala:** calico cat (white/orange/black). She was **Dov's cat**. Animals are untouched by the Reliquary, so she still knows him, which is the proof Rhea needs. In battle she senses Hollows.
- **Blanks:** people who burned everything. Grey raincoats, smooth featureless faces. Slow and tragic.
- **Hollows:** monsters made from stolen lives, shaped from memory-dust.
- **The Clerk (boss):** a Forgotten former royal archivist. Twenty-seven years ago he struck Aurelian's name from every page in Veyra and was proud of it. When Aurelian returned, the Clerk's own name was the first he unwrote. Now he keeps the **Ledger** (the list of who will be erased next) because he was promised he would be remembered when it is full. Tall and thin. Attacks with stamps and filing.
- **Aurelian:** only a silhouette at the end of the demo.

## Chapter 1 — flow
Threads that must pay off: the Unwriting, "she saw a stranger", Hollows made from what is taken, Echo costs you, the letter.
1. **Origin cutscene** (below). Ends: "What you burn, you never get back." then "Seven years after the Hush."
2. **The letter.** Rhea wakes holding a letter in her own handwriting: "Trust Dov. You won't remember why." Yesterday, on a delivery to the Records Office, she saw the Ledger, and Dov's name was next. The ink is still wet.
3. **Meet Dov.** A stranger says he is her brother. He recounts yesterday: she came home white as paper, they tried to reach the Records Office, Hollows pinned them until midnight, then she looked at him and asked who he was. She doesn't believe him until Nala runs to him. Dust gathers into a Hollow; Dov says it is made of him.
4. **Battle 1 — Blank + Hollow** (tutorial: Strike + parry).
5. **After B1.** Something came loose when the Hollow broke: Hollows are what the King took, and pieces drift free (the reward screen). The Forgotten stop belonging to anyone; Dov still belongs to Rhea. His Echo is her on his shoulders at the lantern festival, which she cannot remember. Plan: steal the Ledger before tonight.
6. **Battle 2 — Hollows** (Nala saves). Reward.
7. **Records Office.** The Clerk was the archivist of the Unwriting. The King unwrote him first and put a pen in his hand: fill the Ledger and get your name back. Rhea: the Reliquary promised no one would be forgotten, and you believe him? Clerk: it is the only promise I have left. He calls Dov filed and forgotten and raises the stamp.
8. **Boss — The Clerk.** At phase 2 Rhea burns her last Keepsake: **today, the only memories she has of Dov**. Recollection wins the fight. "What you burn, you never get back."
9. **Ending.** The Ledger falls open, tonight's page blank. Rhea turns to Dov and asks "Who are you?". His name glitches to ▯▯▯. Nala looks up at Rhea. Rhea finds the letter in her coat, reads it, asks "Are you Dov?", and trusts him without knowing why (the cutscene's "saw a stranger" beat, answered). The silhouette of Aurelian watches from the empty plinth. "Chapter 2: The Gallery — locked". End of Demo.

## Cutscene script — "Origin"
Narrated by Rhea. ~2.5 min. Tap = next shot, hold = skip.
Visual keys: `city`, `reliquary`, `battlefield`, `council`, `statue`, `street_rain`, `exile_close` (backgrounds); `aurelian_king`, `aurelian_exile` (transparent cutouts). Game sprites are reused where noted.

| # | Text | Visual |
|---|---|---|
| 1 | Before the Hush, Veyra forgot nothing. | black + crystal particles |
| 2 | Not a face, not a name, not a single life was ever lost. | `city`, slow pan right |
| 3 | Beneath the city stood the Reliquary, an engine of crystal and runes. | `reliquary`, wide |
| 4 | Every memory of every citizen was kept inside it. | `reliquary` zoom in on crystal, light pulse |
| 5 | It was built by the king who ended the Long War. | split: `reliquary` / `aurelian_king` |
| 6 | His name was Aurelian. | `aurelian_king`, zoom on face |
| 7 | The war had lasted forty years. He ended it in one winter. | `battlefield`, wide |
| 8 | It cost him his army, his brother, and the last of his youth. | `battlefield` desaturated + `aurelian_king` kneeling, small |
| 9 | But peace needed someone to blame for the dead. | `council`, silhouettes |
| 10 | The new council named him the butcher of the war he had ended. | `council`, zoom, red tint |
| 11 | His sentence was the cruelest Veyra had ever known: the Unwriting. | `council` + teal glow |
| 12 | Through the Reliquary, every memory of him was torn from every mind. | `reliquary` + `aurelian_king`, dissolve_layer |
| 13 | His statues fell. His name was chiseled from the stone. | `statue`, wide |
| 14 | Even those who loved him forgot he had ever lived. | `statue`, zoom on blank plaque |
| 15 | For twenty years, he wandered the ruins beyond the wall. | `battlefield` night tint + `aurelian_exile`, small |
| 16 | Once, he came back in secret, to see his daughter. | `street_rain` + `aurelian_exile` |
| 17 | She looked straight at him, and saw a stranger. | split: `street_rain` / `exile_close` |
| 18 | That was the day his grief became hatred. | `exile_close`, eyes_glow teal |
| 19 | He did not come back for his throne. | `reliquary`, dark tint |
| 20 | He came back for the crystal that held his name. | split: `reliquary` / `aurelian_exile` (hand on crystal) |
| 21 | They had taught him what the engine could do. Now he would teach them. | `reliquary`, flash + flicker |
| 22 | That night, every light in Veyra went dark. | `city`, lights_out |
| 23 | The world fell silent. We call it the Hush. | `city`, flash → black |
| 24 | Since then, every night, one of us is unremembered. | `city` night + rain |
| 25 | They still live, but no one can recall their face. | `street_rain` + Blank sprite |
| 26 | From what is taken, the King shapes monsters: the Hollows. | `street_rain` + Hollow sprites rising |
| 27 | Steel passes through a Hollow like smoke. | black + Hollow sprite, slash passes through |
| 28 | Only a memory can wound a memory. | black + teal spark |
| 29 | So we learned to burn our own. We call it Echo. | black + Rhea sprite glowing teal |
| 30 | What you burn, you never get back. | black + crystal particles |
| 31 | Seven years after the Hush. | black, then → dialogue "letter" |

## Sprite prompts (pixler.dev)
All: "side-view pixel art RPG battle sprite, … 64px tall, clean outline, transparent background". Use `rhea.png` as the style reference for all the others.
- **Dov:** tall broad young man, heavy worn work jacket, bandaged fists, short dark hair, amber glow accents, facing left.
- **Blank:** hunched figure in a long grey raincoat, smooth featureless face, pale, facing right.
- **Hollow:** creature made of drifting grey-teal memory dust and broken crystal shards, glowing cracks, facing right.
- **The Clerk:** very tall thin archivist in a long black coat, huge ledger book, brass stamp in hand, pale, facing right, 96px tall.
- **Nala:** small calico cat, white with orange and black patches, sitting, facing left, 32px.

## Parking lot (Post-jam)
- **Vael**, "the Strongest": joins later, in a different form than first drafted.
- Who Aurelian's daughter is (major twist).
- Good Forgotten beyond Dov; Hollows that gain intelligence and help.
- Oaths (risk-for-power vows), more techniques, Chapter 2 "The Gallery".
