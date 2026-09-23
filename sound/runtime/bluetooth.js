/**
 * رابط البلوتوث (GATT).
 * هذا المسار يتعرّف الجهاز، البطارية، والهوية، ويعيد الاتصال.
 * بث A2DP لا يمر من Web Bluetooth — الصوت يذهب عبر مخرج النظام (setSinkId).
 * لذلك سقوط هذا الرابط لا يُوقف الصوت عمدًا.
 */

const OPTIONAL_SERVICES = [
  'battery_service',
  'device_information',
  'generic_access',
  'immediate_alert',
  'link_loss',
  'tx_power',
  '00001844-0000-1000-8000-00805f9b34fb',
  '00001845-0000-1000-8000-00805f9b34fb',
  '00001850-0000-1000-8000-00805f9b34fb'
];

const VCS = '00001844-0000-1000-8000-00805f9b34fb';
const VOLUME_POINT = '00002b7e-0000-1000-8000-00805f9b34fb';

export function bluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestDevice;
}

export async function bluetoothAvailability() {
  try {
    if (!navigator.bluetooth?.getAvailability) return null;
    return await navigator.bluetooth.getAvailability();
  } catch {
    return null;
  }
}

export async function requestDevice() {
  if (!bluetoothSupported()) {
    const err = new Error('NO_BLUETOOTH');
    err.code = 'NO_BLUETOOTH';
    throw err;
  }
  return navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: OPTIONAL_SERVICES
  });
}

export async function knownDevices() {
  try {
    if (!navigator.bluetooth?.getDevices) return [];
    return await navigator.bluetooth.getDevices();
  } catch {
    return [];
  }
}

async function readString(service, characteristic) {
  const ch = await service.getCharacteristic(characteristic);
  const value = await ch.readValue();
  return new TextDecoder('utf-8').decode(value).replace(/\0/g, '').trim();
}

async function tryService(server, name) {
  try {
    return await server.getPrimaryService(name);
  } catch {
    return null;
  }
}

export async function inspectLink(device) {
  if (!device.gatt) {
    const err = new Error('NetworkError');
    err.name = 'NetworkError';
    throw err;
  }
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const info = {
    id: device.id,
    name: device.name || 'جهاز بلوتوث',
    battery: null,
    manufacturer: '',
    model: '',
    firmware: '',
    rssi: null,
    volumePoint: null,
    batteryChar: null
  };

  const gap = await tryService(server, 'generic_access');
  if (gap) {
    try {
      const name = await readString(gap, 'gap.device_name');
      if (name) info.name = name;
    } catch {
      try {
        const name = await readString(gap, 'device_name');
        if (name) info.name = name;
      } catch { /* الاسم من الإعلان يكفي */ }
    }
  }

  const dis = await tryService(server, 'device_information');
  if (dis) {
    try { info.manufacturer = await readString(dis, 'manufacturer_name_string'); } catch { /* اختياري */ }
    try { info.model = await readString(dis, 'model_number_string'); } catch { /* اختياري */ }
    try { info.firmware = await readString(dis, 'firmware_revision_string'); } catch { /* اختياري */ }
  }

  const battery = await tryService(server, 'battery_service');
  if (battery) {
    try {
      const ch = await battery.getCharacteristic('battery_level');
      info.batteryChar = ch;
      const value = await ch.readValue();
      info.battery = value.getUint8(0);
      try { await ch.startNotifications(); } catch { /* القراءة الدورية تكفي */ }
    } catch { /* جهاز بلا بطارية معلنة */ }
  }

  const vcs = await tryService(server, VCS);
  if (vcs) {
    try { info.volumePoint = await vcs.getCharacteristic(VOLUME_POINT); } catch { /* مستوى برمجي فقط */ }
  }

  if (device.watchAdvertisements) {
    try {
      await device.watchAdvertisements();
      device.addEventListener('advertisementreceived', (event) => {
        if (typeof event.rssi === 'number') info.rssi = event.rssi;
      });
    } catch { /* ليست كل المنصات تسمح بمراقبة الإعلان */ }
  }

  return { server, info };
}

export async function readBattery(info) {
  if (!info?.batteryChar) return info?.battery ?? null;
  try {
    const value = await info.batteryChar.readValue();
    info.battery = value.getUint8(0);
    return info.battery;
  } catch {
    return info.battery;
  }
}

/** مستوى LE Audio المطلق إن وُجدت الخدمة. الفشل هنا لا يغيّر كسب Web Audio. */
export async function writeAbsoluteVolume(info, unit) {
  if (!info?.volumePoint) return false;
  const v = Math.max(0, Math.min(255, Math.round(unit * 255)));
  const data = new Uint8Array([0x04, v]);
  try {
    if (info.volumePoint.writeValueWithResponse) await info.volumePoint.writeValueWithResponse(data);
    else await info.volumePoint.writeValue(data);
    return true;
  } catch {
    try {
      await info.volumePoint.writeValueWithoutResponse?.(data);
      return true;
    } catch {
      return false;
    }
  }
}

export function backoffMs(attempt) {
  return Math.min(30000, 800 * 2 ** Math.max(0, attempt));
}
