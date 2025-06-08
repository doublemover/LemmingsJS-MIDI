<<<<<<< tmp_merge/ours_.agentInfo_notes_nl-objects.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_nl-objects.md
=======
# NeoLemmix objects note

tags: nl-objects, doc

`docs/nl-objects.md` lists the extra NeoLemmix objects added on top of the classic hatches and exits.  Key behaviours include:

* **Teleporters and receivers** move a lemming as a pair; only one lemming can use a teleporter at a time.
* **Locked exits** open only after every linked button is pressed by a walking lemming.
* **Pickup skills** grant the displayed skill when collected.
* **Traps** may kill instantly or when triggered; single-use traps only work once and can be disarmed.
* **Water** drowns non-swimmers.
* **One-way fields** permit passage in one direction; splitters alternate their direction after each use.
* **Updrafts** slow falling lemmings and lift gliders.
* **Splat pads** kill any lemming landing on them unless it is floating or gliding.
* **Decoration objects** have no gameplay effect.

The original implementations reside in `LemGame.pas` and `LemGadgets.pas` from the NeoLemmix source.  This JavaScript port mirrors their behaviour.
 >>>>>>> tmp_merge/theirs_.agentInfo_notes_nl-objects.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_nl-objects.md
