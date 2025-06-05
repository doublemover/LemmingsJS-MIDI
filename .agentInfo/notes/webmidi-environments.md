# WebMIDI supported environments

tags: webmidi, environment, doc

The official "Supported Environments" page outlines where WebMIDI.js works:

* **Browser support** – Edge 79+, Chrome 43+, Opera 30+ and Firefox 108+ natively implement the Web MIDI API.
* **Jazz-Plugin fallback** – Installing Jazz-Plugin v1.4+ enables Safari and Internet Explorer.
* **Node.js** – Version 3 adds full Node.js support via Jazz-Soft's JZZ module. The docs list GNU/Linux, macOS, Windows and Raspberry Pi as compatible.
* **Electron** – Permission handlers must allow MIDI access:

```javascript
mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
  if (permission === 'midi' || permission === 'midiSysex') {
    callback(true);
  } else {
    callback(false);
  }
})

mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
  if (permission === 'midi' || permission === 'midiSysex') {
    return true;
  }
  return false;
});
```
