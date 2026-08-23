/**
 * @param {{title: string, body: string}} args
 */
export function layout({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Callback</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

/** Escapes text for safe inclusion in HTML (display names, quotes, and reply text all come from harvested comments or Mind output — never trusted as markup). */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
