const html = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function manuscriptExport(repo, novelId, format = "txt") {
  const n = await repo.get(novelId),
    parts = [];
  for (const cid of n.orderedChapterIds) {
    const c = await repo.get(cid),
      scenes = [];
    for (const sid of c.orderedSceneIds) {
      const { scene, text } = await repo.sceneText(sid);
      scenes.push({ title: scene.title, text });
    }
    parts.push({ title: c.title, scenes });
  }
  if (format === "html")
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${html(n.title)}</title><style>body{max-width:42em;margin:3em auto;padding:1em;font:19px/1.8 Georgia,serif;color:#24201b}section{break-before:page}p{white-space:pre-wrap}h1,h2,h3{line-height:1.3}@media print{body{margin:0}}<\/style><h1>${html(n.title)}</h1>${parts.map((c) => `<section><h2>${html(c.title)}</h2>${c.scenes.map((s) => `<h3>${html(s.title)}</h3><p>${html(s.text)}</p>`).join("")}</section>`).join("")}</html>`;
  const heading = (s, level) =>
    format === "md" ? "#".repeat(level) + " " + s : s;
  return (
    heading(n.title, 1) +
    "\n\n" +
    parts
      .map(
        (c) =>
          heading(c.title, 2) +
          "\n\n" +
          c.scenes
            .map((s) => heading(s.title, 3) + "\n\n" + s.text)
            .join("\n\n"),
      )
      .join("\n\n")
  );
}
