const writeStorageEntries = (storage, entries) => {
  if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function') return false;
  const previous = [];
  try {
    for (const [key] of entries) previous.push([key, storage.getItem(key)]);
  } catch (error) {
    return false;
  }
  let attempted = 0;
  try {
    for (const [key, value] of entries) {
      attempted += 1;
      storage.setItem(key, value);
    }
    return true;
  } catch (error) {
    for (let index = attempted - 1; index >= 0; index -= 1) {
      const [key, value] = previous[index];
      try {
        if (value == null) storage.removeItem?.(key);
        else storage.setItem(key, value);
      } catch (rollbackError) {
        // Keep trying the other keys so a failed index write can restore level content.
      }
    }
    return false;
  }
};

export { writeStorageEntries };
