export const toasts = [];

export function showToast(options) {
  toasts.push(options);
  const { text, variant } = options;
  const toast = document.createElement('div');
  toast.className = 'nx-toast';
  toast.dataset.variant = variant;
  toast.setAttribute('role', 'alert');
  toast.textContent = text;
  document.body.append(toast);
}
