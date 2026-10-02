# Unremembered — Story Bible v2 (Fri 2/10)

Replaces v1 completely. Source of truth for every story text in the game (cutscene, dialogue, battle events, flavor). Code-facing decisions live in `docs/STATUS.md`.

## World
- **Veyra**, capital of a hextech kingdom: rune engines, lanterns, clockwork, towers. No guns, cars or phones.
- **The Reliquary:** an engine of crystal and runes under the city. Version 1 turned **fading memories, given freely**, into light and power. It solved Veyra's energy problem: the lanterns never went dark.
- **King Aurelian** built it. He was a king and an engineer.
- **The Long War** lasted **twenty years**. To end it, Aurelian rebuilt the engine into a weapon: it could tear a person out of every mind that knew them. That gave more power than anything before. He used it on the enemy: soldiers forgotten by their own families broke, and so did their armies. He won.
- **The council** feared a king who held a weapon that could erase anyone. They took the engine, named him the butcher of the war he had won, and sentenced him with his own weapon: **the Unwriting**. Every memory of him was torn from every mind. Even his daughter forgot him.
- He wandered the ruins beyond the wall for years. Once he came back in secret to see his daughter; she looked at him and saw a stranger. Grief became hatred.
- He came back for the engine. That night he fed it the council, then thousands more, and every light in Veyra went dark: **the Hush**. When the light returned, the king and the engine were one.
- **A hundred years later he still rules.** Veyra lives under tyranny. Some accept it because it pays: those who serve him live for decades longer than they should. Everyone else learns to keep quiet.
- **Why he keeps taking:** unknown. In the demo it stays a mystery.

## Power structure
- **Aurelian:** the king fused with the Reliquary. The only one who can unwrite someone from afar.
- **Memorists:** trained Echo users from the King's **Memorist School**. A strong memorist can do far more than fight, including stretching their own life.
- **Magistrates:** local rulers of each ward, appointed by the King. Memorists themselves. They request and perform unwritings in their ward.
- **Clerks:** keep each ward's **Ledger**.
- **Couriers:** carry letters and warrants between the King's offices.
- **Ordinary people** use Echo too. Some learned it before the war, from the first Reliquary (light, heat, mending). Others copied the King's guards, soldiers and clerks, mostly for fighting.

## The Forgotten
- **Unwriting** a person tears them out of every mind that knew them. They become **Forgotten**.
- No one can remember a Forgotten, **or keep a new memory of them**, not even a minute later. That is why most of them go mad.
- Nobody can hold their faces in mind, so they have none: smooth, featureless, grey raincoats.
- A magistrate like Quill keeps some as strays. A memorist can hold them in mind, and they follow whoever still remembers them.
- One word only: **Forgotten**. The word "Blank" is retired from all player-facing text (the code key `blank` can stay).

## Unwriting — rules
- It is a **ritual**. It needs the target's **name**, written in the **Ledger** (the Ledger is the memorists' record and part of the ritual, not a hit list).
- The caster must be **close to the target**. Only Aurelian can do it from afar.
- It can **backfire** on a strong target. A caster who has felt a backfire is afraid to try again.
- What it takes is recorded in the Ledger. A memorist can read a page and give back a part of what was taken.

## Echo — rules
1. **Weight = power.** Trivial memories give sparks; precious ones give storms.
2. What you burn is gone **for you**. Others still remember it.
3. **The present makes new sparks.** Every moment of a fight is a fresh memory, so Echo refills in battle.
4. Your technique is shaped by your strongest memory.
5. **Steel passes through a Hollow like smoke.** Hollows are made of Echo, so only Echo wounds them.
- **Keepsake:** a precious memory held in reserve. Burning one gives a flood of Echo.
- **Recollection:** the ultimate. A memorist drags the enemy into a memory and burns it around them. Rhea's: the night Quill came for their mother.
- **Echo capacity follows memories.** Few memories, few pips. Rhea wakes with almost none, so she starts with **1 pip**. Dov can never hold more than **5**.

## Hollows
Monsters shaped by memorists from what unwriting takes. Immune to Strike. A **Warden Hollow** is a bigger, older one that drinks Echo and heals on it.

## Characters (demo)
- **Rhea:** early 20s, short white hair, long dark navy coat, messenger bag, collapsible baton. Teal Echo. Adopted by Dov's family as a small child. After what happened to their parents she became a **courier** in Quill's office, as a cover: the plan was to get close and kill Quill, then the King. She trained at the Memorist School and turned out to convert Echo exceptionally well. Fast, damage. The only one who can use Recollection.
- **Dov:** Rhea's adoptive brother. Tall and broad, worn work jacket, bandaged fists, short dark hair. Amber Echo. Remembers everything. A weak memorist: max 5 Echo, no Recollection. Tank and support.
- **Nala:** the family's calico cat. After the wipe she is **the only thing Rhea remembers**. Nobody knows why ("No idea why you remember her."). She is special; that is revealed later in the story. In battle she senses Hollows.
- **Magistrate Orsin Quill, "the Clerk":** magistrate of the Lower Ward, a memorist, keeps the ward's Ledger. Tall and thin, black coat, huge Ledger, brass stamp. Had Rhea's mother unwritten years ago. Cast the King's warrant on Rhea and took half the backfire, so people are slowly forgetting him. Serves the King because he was promised he will be remembered again once Rhea's page is finished. Speaker name in dialogue: **Quill**. At the end of the boss fight the backfire finishes: he becomes Forgotten.
- **Rhea's parents:** the **father** died fighting Quill's men the night the **mother** was unwritten. The mother became Forgotten, went mad and walked out of the city. Nobody knows where she is. Rhea and Dov only know someone was there; they cannot recall who she was.
- **Aurelian:** only a silhouette at the end of the demo.

## Rhea's last night (backstory, told by Dov)
1. The magistrates noticed how strong Rhea had become and warned the King. He saw how well she converts Echo, wanted the problem gone early, and signed a **warrant to unwrite her**.
2. Quill cast it. It **backfired**: a red aura flared around Rhea. Instead of the world forgetting her, **she** started forgetting small things. The backfire also hit Quill: people started forgetting **him**, a little.
3. Quill understood, and hit her with his strongest spell to overwhelm her ability. The reverse effect went all the way: instead of everyone forgetting her, **she forgot everything**.
4. Just before, she wrote herself a short letter.
5. Quill left her empty. Who fears an empty courier? And he is afraid to cast on her again.

## Chapter 1 — flow
| # | Step | Content |
|---|---|---|
| 1 | cutscene `origin` | 30 shots, narrator (not Rhea) |
| 2 | dialogue `letter` (black) | Rhea wakes: "Ow... my head." The letter. |
| 3 | dialogue `meet_dov` (street_rain) | Dov finds her. She doesn't trust him and attacks. |
| 4 | battle `b0_duel` | **Tutorial.** Rhea alone vs Dov. Strike, parry, Blast v1. Dov refuses to fight at first. Nala stops it at Dov 50% HP. |
| 5 | dialogue `after_duel` (street_rain) | Nala. "No idea why you remember her." Forgotten arrive. |
| 6 | battle `b1_forgotten` | Rhea + Dov vs 2 Forgotten. **Break** is taught here. |
| 7 | reward | |
| 8 | dialogue `after_b1` (street_rain) | Dov tells her who she is. They head for Quill's Records Office. |
| 9 | battle `b2_first_hollow` | Forgotten + first Hollow. Strike is immune → event. Nala's save is taught here. |
| 10 | dialogue `before_gate` (street_rain) | The two Hollows Quill set at the door. |
| 11 | battle `b3_gate` | Hollow + Warden Hollow (siphon with lifesteal, Maul with a feint). |
| 12 | reward | |
| 13 | dialogue `records_office` | Rhea reads her page: Dov and her father come back, not her mother. Quill walks in. |
| 14 | battle `boss_clerk` | Phase 2: Rhea burns the page (Keepsake) → Recollection. |
| 15 | dialogue `ending` | "I know your name. I don't know why it hurts." Silhouette. Chapter 2 locked. |

## Cutscene script — "Origin"
Narrator, third person. Same art and shot layout as v1 unless noted.

| # | Text | Visual |
|---|---|---|
| 1 | Veyra was a city of lanterns that never went dark. | `city`, zoom out, crystal particles |
| 2 | Their light came from memories: the fading ones, given freely. | `city`, pan right |
| 3 | Beneath the city, an engine of crystal and runes turned them into light. | `reliquary`, wide |
| 4 | They called it the Reliquary. | `reliquary` zoom in, light pulse |
| 5 | It was built by a king who was also an engineer. | split `reliquary` / `aurelian_king` |
| 6 | His name was Aurelian. | `aurelian_king`, zoom on face |
| 7 | Then came the Long War. Twenty years of it. | `battlefield`, embers |
| 8 | To end it, he taught the engine to tear a soldier out of every mind that knew him. | `battlefield` desaturated + `aurelian_king_kneel` |
| 9 | The enemy broke. But the council saw what their king now held. | `council` |
| 10 | Afraid of him, they took the engine and named him the butcher of the war he had won. | `council`, zoom, red tint |
| 11 | His sentence was his own weapon: the Unwriting. | `council` + teal particles |
| 12 | Every memory of him was torn from every mind in Veyra. | `reliquary` + `aurelian_king`, dissolve |
| 13 | His statues fell. His name was chiseled from the stone. | `statue` |
| 14 | Even those who loved him forgot he had ever lived. | `statue`, zoom |
| 15 | For years, he wandered the ruins beyond the wall. | `battlefield` night + `aurelian_exile_kneel` |
| 16 | Once, he came back in secret, to see his daughter. | `street_rain` + `aurelian_exile` |
| 17 | She looked straight at him, and saw a stranger. | split `street_rain` / `exile_close` |
| 18 | That was the day his grief became hatred. | `exile_close`, eyes glow |
| 19 | He did not come back for his throne. | `reliquary`, dark tint |
| 20 | He came back for the engine they had stolen. | split `reliquary` / `aurelian_exile` |
| 21 | That night, he fed it the council. Then thousands more. | `reliquary`, flash + particles |
| 22 | Every light in Veyra went dark. They call it the Hush. | `city`, lights_out, sfx `hush`, 5000 ms |
| 23 | When the light returned, the king and the engine were one. | `city`, flash only (**changed:** no lights_out, the city is lit again) |
| 24 | A hundred years later, he still rules. His servants live for decades more. | `city` night tint + rain |
| 25 | Those who defy him are unwritten. No one can keep a memory of them: the Forgotten. | `street_rain` + Forgotten sprite |
| 26 | From what is taken, his memorists shape monsters: the Hollows. | `street_rain` + Hollows |
| 27 | Steel passes through a Hollow like smoke. | black + Hollow, flash |
| 28 | Only a memory can wound a memory. | black + particles |
| 29 | So the people learned to burn their own. They call it Echo. | black + Rhea glowing |
| 30 | And a few of them learned to fight back. | black, 3500 ms → dialogue `letter` |

## Dialogue
Notation: `Speaker [portrait]: text`. `>` = narration (no speaker). `✉` = letter style. Speaker `▯▯▯` uses the existing glitch name style.

### letter (bg black)
- Rhea [rhea_pained]: Ow... my head.
- > A cold floor. Rain on a window. A letter in her hand.
- > The handwriting is hers. She doesn't remember writing it.
- > She doesn't remember anything.
- ✉ If you're reading this, he got me. He took everything.
- ✉ Trust Dov. You won't remember why. — R.
- Rhea [rhea_confused]: Who is Dov? ...Who am I?

### meet_dov (street_rain)
- > Night. The street outside is drowning in rain.
- Dov [dov_worried]: Rhea! I've been looking for you all day. Are you hurt?
- Rhea [rhea_serious]: Stay where you are.
- Dov [dov_neutral]: It's me. Dov.
- Rhea [rhea_angry]: Anyone can read a letter and say a name.
- Dov [dov_sad]: Rhea, please. What did he do to you?
- Rhea [rhea_angry]: Last chance. Back off.
- > She draws her baton. Her hands know how, even if she doesn't.

### Battle b0_duel — events
- `duel_refuse` (after Rhea's 1st landed hit):
  - Dov [dov_worried]: I'm not fighting you, Rhea.
  - Rhea [rhea_serious]: Then this will be quick.
- `duel_wake` (after Rhea's 3rd landed hit, or round 3, whichever first; Dov starts attacking):
  - Dov [dov_fierce]: Fine. Wake up, then!
  - > He raises his fists. He's holding back, but not by much.
- `duel_nala` (Dov at or below 50% HP; the battle ends):
  - > A calico cat bolts out of the rain and plants herself between them.
  - Rhea [rhea_confused]: ...Nala?

### after_duel (street_rain)
- Dov [dov_warm]: Nala! Easy, girl. Easy.
- Rhea [rhea_confused]: I know her. I don't know my own name, but I know hers.
- Dov [dov_worried]: You remember the cat... and not me?
- Dov [dov_neutral]: No idea why you remember her. But she's never wrong about people.
- Rhea [rhea_serious]: ...Then I'll trust her. For now.
- > Nala's fur stands on end. She hisses at the dark.
- > Grey raincoats in the fog. Smooth faces. No eyes.
- Dov [dov_fierce]: Forgotten. Quill's strays.
- Rhea [rhea_confused]: Who's Quill?
- Dov [dov_fierce]: Later. Stay close!

### after_b1 (street_rain)
- Rhea [rhea_serious]: Talk. Who am I?
- Dov [dov_neutral]: Rhea. My sister. My parents took you in when you were small.
- Dov [dov_sad]: Quill is the magistrate of our ward. Years ago, he had our mother unwritten.
- Dov [dov_sad]: Dad died fighting his men. Mom became Forgotten.
- Rhea [rhea_serious]: Like the ones we just fought?
- Dov [dov_sad]: Nobody can hold on to them, not even for a minute. Most of them break.
- Dov [dov_sad]: One day Mom walked out of the city. We don't know where she is.
- Rhea [rhea_pained]: And me?
- Dov [dov_neutral]: You became a courier. Carried Quill's letters, smiled at his clerks.
- Dov [dov_fierce]: You wanted to get close enough to kill him. Then the King.
- Dov [dov_neutral]: You trained at the Memorist School. You got strong. Too strong.
- Dov [dov_worried]: The King signed a warrant to unwrite you. Quill cast it. It backfired.
- Dov [dov_worried]: People started forgetting him. So he hit you with everything he had.
- Rhea [rhea_pained]: And instead of the world forgetting me... I forgot the world.
- Dov [dov_neutral]: Memorists write down everything they take. It's all in his Ledger.
- Rhea [rhea_determined]: Then we pay the magistrate a visit.
- > Into the night. Nala leads the way.

### Battle b2_first_hollow — events
- `b2_start` (battle start):
  - > Behind the Forgotten, grey dust gathers into something with claws.
  - Dov [dov_fierce]: A Hollow. Watch Nala. She feels them before they strike.
- `b2_immune` (first Strike on a Hollow, after its IMMUNE text):
  - Rhea [rhea_confused]: It went right through!
  - Dov [dov_fierce]: Hollows are made of Echo. Steel won't touch them. Only Echo will.
  - Rhea [rhea_determined]: Then I burn something.
  - Dov [dov_worried]: You don't have much left to burn. Make it count.

### before_gate (street_rain)
- > The Records Office. Two shapes of dust guard the door. One is twice the size of the other.
- Dov [dov_fierce]: Quill's watchdogs. The big one drinks Echo, and heals on it.
- Rhea [rhea_determined]: Then we don't let it drink.

### records_office (records_office)
- > Shelves to the ceiling. On a lectern, open: the Ledger.
- > Rhea finds her own name. The ink has burned through the page.
- Rhea [rhea_serious]: There's something here. Something of mine.
- > She touches the page, and remembers.
- > A boy with bandaged fists, giving her half his bread.
- > A tall man at the door, laughing at the rain.
- > A woman at the table. Her face won't come.
- Rhea [rhea_sad]: Dov. I remember you.
- Dov [dov_warm]: Welcome back.
- Quill [clerk_smug]: How touching. And how kind of you to come to me.
- Rhea [rhea_angry]: Quill.
- Quill [clerk_cold]: Magistrate Quill. People keep forgetting the title. Thanks to you.
- Quill [clerk_cold]: His Majesty doesn't trouble himself with couriers. That's what I'm for.
- Quill [clerk_desperate]: Finish her page, he said, and they will remember me again.
- Dov [dov_fierce]: You took our mother. You don't get her too.
- Quill [clerk_smug]: I left her empty. Who fears an empty courier?
- Quill [clerk_furious]: Last time she had a whole life to burn. Now she has one page. This will be easy.

### Boss — archive_insight (after the first Archive release; text unchanged from v1)
- Rhea [rhea_pained]: He pulled back inside that book... and we couldn't touch him.
- Dov [dov_worried]: Every blow we landed came back as his.
- Rhea [rhea_determined]: Then we don't let him sit in there. Hit him until he staggers. Hard and fast.

### Boss — keepsake_burn (phase 2)
- Rhea [rhea_pained]: He's right. I can't beat him like this.
- > A Keepsake: a memory held back for the end. Rhea has one. The page.
- Dov [dov_worried]: Rhea, don't. You just got us back.
- Rhea [rhea_sad]: Goodbye, Dov. Goodbye, Dad.
- Rhea [rhea_sad]: I'm forgetting you again. But I'll remember you... again.
- ▯▯▯ [none]: Rhea—
- > She burns it. Her Echo floods back, brighter than it has ever been.
- > Recollection: she can drag Quill into the memory as it burns. The night he came for their mother.

Tutorial banner when Recollection unlocks: **"Recollection is ready. Make him relive it."**

### ending (records_office)
- Quill [clerk_desperate]: No... They were going to remember me...
- > His face blurs. Even as she looks at him, Rhea can't hold on to it.
- > The Ledger lies open. Her page is ash.
- Rhea [rhea_confused]: You. You fought beside me.
- Dov [dov_sad]: I did.
- Rhea [rhea_confused]: Your name is Dov. I know that much. I don't know why it hurts.
- Dov [dov_warm]: That's all right. I'll remember for both of us.
- > Nala presses against Rhea's leg. That, she still remembers.
- > Somewhere above the city, a silhouette watches from the broken tower. *(silhouette: `aurelian_exile`)*
- > Chapter 2: The Gallery — locked.

## Flavor text fixes
- Anchor flavor: "The night they took Mom, he held his sister until morning." (v1 referenced the Hush, which is now 100 years ago.)
- Any player-facing "Blank" → "Forgotten". Any "seven years after the Hush" or "the rain hasn't stopped since the Hush" → removed.

## Gameplay arc (story ↔ mechanics)
- **Duel (b0):** Rhea alone, 1 Echo pip, Strike + **Blast v1** (cost 1, exactly 2 bolts, no crit). Dov has no break meter. He refuses to attack until `duel_wake`; then the slow-mo parry tutorial runs on his attacks.
- **Echo capacity grows with Recall level** (she is getting memories back). Rhea's row always shows 10 pips, locked ones dim: the missing memories. Dov's row shows 5.
- **b1:** Break is taught. **b2:** Hollow immunity + Nala are taught. **b3:** Warden Hollow tests both.
- **Boss:** before phase 2 Rhea's cap stays at its level value (max 8). The page burn raises it to 10 and fills it: Recollection unlocks only from there.

## Sprite prompts (pixler.dev)
All: "side-view pixel art RPG battle sprite, … clean outline, transparent background". Use `rhea.png` as the style reference.
- **Warden Hollow** (only if the 2× Hollow doesn't work): hulking creature of grey-teal memory dust and broken crystal shards, glowing cracks, heavier and older than a Hollow, facing right, 256×256 canvas.
- Others unchanged from v1 (Forgotten = the `blank` sprite).

## Parking lot (Post-jam)
- Why Rhea remembers Nala (Nala's secret).
- Where the mother is.
- Rhea's adoption, origin and red aura.
- Aurelian's daughter (major twist).
- What Aurelian is still building, and why he keeps taking.
- The Memorist School.
- Vael, "the Strongest". Good Forgotten; Hollows that gain intelligence and help.
- Oaths, more techniques, Chapter 2 "The Gallery".
