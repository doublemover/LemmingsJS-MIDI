const createMidiUiErrorReporter = ({
  document,
  getDeviceSnapshot = () => ({}),
  getLastEnableError,
  setLastEnableError
}) => {
  const getErrorDisplay = () => document.getElementById('errorDisplay');

  const clearErrorDisplay = () => {
    const errorDisplay = getErrorDisplay();
    if (!errorDisplay) return;
    if (typeof errorDisplay.replaceChildren === 'function') {
      errorDisplay.replaceChildren();
    } else if ('innerHTML' in errorDisplay) {
      errorDisplay.innerHTML = '';
    }
    errorDisplay.textContent = '';
  };

  const appendError = (message) => {
    const errorDisplay = getErrorDisplay();
    if (!errorDisplay || !message) return;
    const text = String(message);
    if (typeof document?.createTextNode === 'function' && typeof errorDisplay.appendChild === 'function') {
      errorDisplay.appendChild(document.createTextNode(text));
      errorDisplay.appendChild(document.createElement('br'));
      return;
    }
    const prev = errorDisplay.textContent || '';
    errorDisplay.textContent = prev ? `${prev}\n${text}` : text;
  };

  const renderErrorDisplay = ({ inputs, outputs } = {}) => {
    clearErrorDisplay();
    const lastEnableError = getLastEnableError();
    if (lastEnableError) appendError(lastEnableError);
    if (Array.isArray(inputs) && inputs.length < 1) {
      appendError('No input device detected.');
    }
    if (Array.isArray(outputs) && outputs.length < 1) {
      appendError('No output device detected.');
    }
  };

  const showError = (message) => {
    setLastEnableError(message || null);
    renderErrorDisplay(getDeviceSnapshot());
  };

  return {
    appendError,
    clearErrorDisplay,
    getErrorDisplay,
    renderErrorDisplay,
    showError
  };
};

export { createMidiUiErrorReporter };
