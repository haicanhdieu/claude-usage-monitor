const { Tray, Menu, nativeImage } = require('electron');

function createTray({ onOpen, getLoginItem, setLoginItem, onQuit }) {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Claude Usage Monitor');
  const build = () => Menu.buildFromTemplate([
    { label: 'Open', click: onOpen },
    { label: 'Launch at login', type: 'checkbox', checked: !!getLoginItem(), click: (item) => { setLoginItem(item.checked); } },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]);
  tray.setContextMenu(build());
  tray.on('click', onOpen);
  tray.on('right-click', () => tray.setContextMenu(build())); // refresh checkbox state
  return { setTitle: (text) => tray.setTitle(text) };
}

module.exports = { createTray };
