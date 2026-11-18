import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const FILENAME = 'quizard-class-template.xlsx';
const TEMPLATE_URL = 'templates/quizard-class-template.xlsx';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Browser: a normal download. Android WebView has no download manager, so the
// native build writes the template to cache and opens the share sheet.
export async function saveClassTemplate(): Promise<void> {
  const href = new URL(TEMPLATE_URL, document.baseURI).href;
  if (!Capacitor.isNativePlatform()) {
    const a = document.createElement('a');
    a.href = href;
    a.download = FILENAME;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  const response = await fetch(href);
  if (!response.ok) throw new Error('Template file is missing from the app.');
  const file = await Filesystem.writeFile({
    path: FILENAME,
    data: toBase64(await response.arrayBuffer()),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({
    title: 'Quizard class template',
    text: 'Fill in the class details and students, then upload it in Add class.',
    files: [file.uri],
    dialogTitle: 'Save or share the Excel template',
  });
}
