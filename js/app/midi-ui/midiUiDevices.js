const toDeviceList = (devices) => {
  if (!devices) return [];
  if (Array.isArray(devices)) return devices;
  if (typeof devices.values === 'function') return Array.from(devices.values());
  if (typeof devices[Symbol.iterator] === 'function') return Array.from(devices);
  return [];
};

const resolveMidiId = (devices, ...preferredIds) => {
  const list = toDeviceList(devices);
  if (!list.length) return null;
  for (const id of preferredIds) {
    if (!id) continue;
    if (list.some(device => device?.id === id)) return id;
  }
  return list[0]?.id || null;
};

const populateMidiSelect = (document, select, devices, emptyLabel) => {
  const list = toDeviceList(devices);
  if (!select) return;
  select.innerHTML = '';
  if (!list.length) {
    const opt = document.createElement('option');
    opt.textContent = emptyLabel;
    opt.value = '';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const device of list) {
    const opt = document.createElement('option');
    opt.textContent = device.name;
    opt.value = device.id;
    select.appendChild(opt);
  }
};

export {
  populateMidiSelect,
  resolveMidiId,
  toDeviceList
};
