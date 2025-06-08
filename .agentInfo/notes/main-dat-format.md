<<<<<<< tmp_merge/ours_.agentInfo_notes_main-dat-format.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_main-dat-format.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_main-dat-format.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_main-dat-format.md
=======
# MAIN.DAT sections

tags: main-dat, doc

`docs/camanis/lemmings_main_dat_file_format.md` describes the seven sections found after decompressing `MAIN.DAT`.

- **0** – lemming animations
- **1** – destruction masks and exploder digits
- **2** – high performance skill panel + 8x8/8x16 fonts
- **3** – main menu backgrounds and F-key signs
- **4** – blink animations, scroller pieces and purple font
- **5** – unknown, identical in MAIN.DAT and CGAMAIN.DAT
- **6** – standard skill panel and green text font

`GameResources` loads `MAIN.DAT` via `FileContainer`. Sprite helpers map parts directly:

```javascript
getLemmingsSprite()      // part 0
getMasks()               // part 1
getSkillPanelSprite()    // parts 2 and 6
getCursorSprite()        // part 5
```

Sections 3 and 4 are currently unused by the loader.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_main-dat-format.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_main-dat-format.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_main-dat-format.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_main-dat-format.md
