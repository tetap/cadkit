/** Consistent Lucide-style stroke icons for tool rail / chrome. */
const icon = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const ICONS = {
  select: icon('<path d="m5 3 6.8 17 2.1-6.1L20 11.8 5 3Z"/><path d="m14 14 4.5 4.5"/>'),
  pan: icon('<path d="M18 11V7a2 2 0 0 0-4 0v3"/><path d="M14 10V5a2 2 0 0 0-4 0v5"/><path d="M10 10V7a2 2 0 0 0-4 0v7"/><path d="M6 12.5 4.8 11a2 2 0 0 0-3 2.6l4.7 5.5A5 5 0 0 0 10.3 21H14a6 6 0 0 0 6-6v-4a2 2 0 0 0-4 0v1"/>'),
  line: icon('<circle cx="5" cy="18.5" r="1.5"/><circle cx="19" cy="5.5" r="1.5"/><path d="m6.1 17.5 11.8-11"/>'),
  rectangle: icon('<rect x="4" y="5" width="16" height="14" rx="1.5"/>'),
  ellipse: icon('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  circle: icon('<circle cx="12" cy="12" r="8.5"/>'),
  polyline: icon('<path d="m3.5 17 5-10 6 7 6-10"/><circle cx="3.5" cy="17" r="1"/><circle cx="8.5" cy="7" r="1"/><circle cx="14.5" cy="14" r="1"/><circle cx="20.5" cy="4" r="1"/>'),
  pen: icon('<path d="m12 19 7-7 3 3-7 7-4 1 1-4Z"/><path d="m18 13-7-7-8 3 7 7"/><path d="m3 9 4.5 1.5"/><circle cx="9" cy="12" r="1.5"/>'),
  brush: icon('<path d="M4 20c2-1 3-4 4-7s3-5 6-6 5 0 6 2-1 5-3 6-5 2-7 3-5 3-6 2Z"/><path d="m9 11 4 4"/>'),
  text: icon('<path d="M5 5h14"/><path d="M12 5v14"/><path d="M8.5 19h7"/>'),
  image: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 17 5-4 3.5 3 4.5-5 5 6"/>'),
  group: icon('<rect x="3" y="3" width="11" height="11" rx="1.5"/><rect x="10" y="10" width="11" height="11" rx="1.5"/>'),
  ungroup: icon('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M15 7h2v2M7 15v2h2"/>'),
  undo: icon('<path d="m9 7-5 5 5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>'),
  redo: icon('<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0-6 6"/>'),
  layers: icon(
    '<path d="m12 2 9 4.5-9 4.5L3 6.5 12 2Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 17.5 9 4.5 9-4.5"/>',
  ),
} as const

export type IconName = keyof typeof ICONS
