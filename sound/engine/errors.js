/** رسائل عربية واضحة، بلا أكواد خام أمام المستمع. */

export function explainError(err) {
  const name = err?.name || '';
  const code = err?.code || '';
  const msg = String(err?.message || '');
  if (code === 'NO_BLUETOOTH') {
    return 'هذا المتصفح لا يدعم بلوتوث الويب. استخدم Chrome أو Edge، أو افتح التطبيق في نافذة كاملة. الصوت على مخرج النظام يبقى متاحًا.';
  }
  if (code === 'NO_OUTPUT_PICKER') {
    return 'اختيار مخرج مستقل غير متاح في هذا المتصفح. سيبقى الصوت متصلًا على مخرج النظام.';
  }
  if (code === 'NO_AUDIO' || code === 'DECODE') {
    return 'تعذّر قراءة هذا الملف. جرّب MP3 أو WAV أو OGG، والصوت الحالي لم يُقطع.';
  }
  if (code === 'NO_MIC') {
    return 'المعايرة تحتاج الميكروفون. لم يُمنح الإذن، والموسيقى عادت كما كانت.';
  }
  if (name === 'NotFoundError') return 'لم يُختر جهاز.';
  if (name === 'NotAllowedError') return 'لم يُمنح الإذن. اضغط الزر مرة أخرى واختر السماح.';
  if (name === 'SecurityError') {
    return 'المتصفح منع البلوتوث داخل هذه النافذة. افتح التطبيق في تبويب كامل ثم اسمح.';
  }
  if (name === 'NetworkError') {
    return 'تعذّر ربط الجهاز. السماعات الأخرى ما زالت تعمل، وستُعاد المحاولة وحدها.';
  }
  if (/secure|https|permission/i.test(msg) && name === 'NotSupportedError') {
    return 'هذه الميزة تحتاج اتصالًا آمنًا (HTTPS) أو Chrome حديثًا.';
  }
  if (name === 'NotSupportedError') return 'الجهاز أو المتصفح لا يدعم هذه العملية. بقية المسارات لم تتأثر.';
  if (msg && msg.length < 160) return msg;
  return 'تعذّرت العملية. الصوت على المسارات السليمة مستمر.';
}
