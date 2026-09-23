/** مخارج الصوت في النظام — هنا يُسمع الصوت فعليًا، بما فيها سماعات البلوتوث بعد اقترانها. */

export function sinkIdSupported() {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

export function outputPickerSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.selectAudioOutput;
}

export async function pickOutput() {
  if (!navigator.mediaDevices?.selectAudioOutput) {
    const err = new Error('NO_OUTPUT_PICKER');
    err.code = 'NO_OUTPUT_PICKER';
    throw err;
  }
  const device = await navigator.mediaDevices.selectAudioOutput();
  return {
    deviceId: device.deviceId,
    label: device.label || 'مخرج صوت',
    groupId: device.groupId || ''
  };
}

export async function listOutputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter(d => d.kind === 'audiooutput')
    .map(d => ({
      deviceId: d.deviceId,
      label: d.label || (d.deviceId === 'default' ? 'مخرج النظام' : ''),
      groupId: d.groupId || ''
    }));
}

export function watchOutputs(onChange) {
  if (!navigator.mediaDevices?.addEventListener) return () => {};
  const fn = () => { onChange(); };
  navigator.mediaDevices.addEventListener('devicechange', fn);
  return () => navigator.mediaDevices.removeEventListener('devicechange', fn);
}
