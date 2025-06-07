# L2 savegame format

tags: l2, savegame, doc, todo


`docs/camanis/lemmings_2_save_file_format.md` explains the DOS save structure. A file stores **eight slots**. Each slot begins with a 25-byte name followed by 482 bytes of data:

* 12 tribe records appear first (40 bytes each) ordered Classic to Sports.
  * byte `0x00` – number rescued
  * byte `0x01` – unknown
  * byte `0x02` – medal value
  * byte `0x03` – unknown
* Two bytes at `0x01e0` store the last-played tribe index.

TODO
- implement read/write support for these slots
- figure out the purpose of the unknown bytes
- allow editing slot names and last tribe index
