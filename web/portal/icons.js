(() => {
const paths = {
  mark:'<path fill="none" stroke="currentColor" stroke-width="1.65" d="M12 2.5 20.5 7.3v9.4L12 21.5l-8.5-4.8V7.3Z"/><path d="M12 2.5v19M3.5 7.3l17 9.4m0-9.4-17 9.4"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.4 4.4"/>',
  space:'<path d="M4 9v6h16V9"/>',
  arrow:'<path d="M3 12h18m-5-5 5 5-5 5"/>',
  apps:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  out:'<path d="M7 17 17 7M7 7h10v10"/>',
  motion:'<path d="M2 12h4l2-5 4 10 3-8 2 3h5"/>',
  cell:'<path d="M4 11c0-4 2.7-7 6.3-7 2.1 0 4 1.1 5.2 3 3 .3 4.5 2.3 4.5 4.9 0 4.2-3.8 7.6-8.4 7.6S4 15.4 4 11Z"/><circle cx="10" cy="11.5" r="1"/><circle cx="15" cy="11.5" r="1"/>',
  chart:'<path d="M4 19h16M6 15v-4m4 4V7m4 8V9m4 6V4"/>',
  crm:'<circle cx="8" cy="8" r="3"/><path d="M2.5 19v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2m2-14a3 3 0 0 1 0 6m1 2a4 4 0 0 1 5 4v2"/>',
  doc:'<path d="M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6"/>',
  heart:'<path d="M12 20S3 15.7 3 9.8C3 5 8.5 4 12 8c3.5-4 9-3 9 1.8 0 5.9-9 10.2-9 10.2Z"/><path d="M6.5 12h3l1.4-2.2 2.2 4 1.5-1.8h3"/>',
  report:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M8 3h8v4H8Zm1 8h6m-6 4h6m-6 3h4"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  git:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m12-9a6 6 0 0 1-6 6H6"/>',
  flow:'<circle cx="4.5" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19.5" cy="12" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6.5 12h11m-10 0c2 0 2.5-1.7 3.5-4m-3.5 4c2 0 2.5 1.7 3.5 4"/>',
  gate:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Zm-2.5 5L6 12l3.5 4m5-8 3.5 4-3.5 4"/>',
  terminal:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 6-3 6-3 8h18c0-2-3-2-3-8M10 20a2 2 0 0 0 4 0"/>',
  chip:'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3m-6 12v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  color:'<circle cx="9" cy="9" r="4"/><circle cx="15" cy="9" r="4"/><circle cx="12" cy="14" r="4"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  wave:'<path d="M3 10c3.5.3 4.1 4.7 8.2 4.7 2.5 0 4.3-2.4 5.4-4.4 1.3.9 2.9 1.3 4.4.6-1.7 4.6-4.9 6.5-8.9 6.5C6.6 17.4 4.8 13.6 3 10Zm9 1c1-2 2.5-3.2 4.5-4.3"/>'
};
window.dioPrototypeIcon = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] ?? paths.gate}</svg>`;
})();
