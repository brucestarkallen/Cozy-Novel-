export const $ = (s) => document.querySelector(s);
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on"))
      n.addEventListener(k.slice(2).toLowerCase(), (event) => {
        try {
          const result = v(event);
          if (result?.catch)
            result.catch((error) => notice(error.message, true));
        } catch (error) {
          notice(error.message, true);
        }
      });
    else if (["value", "checked", "hidden", "disabled"].includes(k)) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null)
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
export const button = (text, action, data = {}, className = "") =>
  el(
    "button",
    {
      "data-action": action,
      class: className,
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => ["data-" + k, v]),
      ),
    },
    text,
  );
export function notice(text, error = false) {
  $("#notice").textContent = text;
  $("#notice").classList.toggle("error", error);
  if ($("#modal")?.open) {
    let local = $("#modalNotice");
    if (!local) {
      local = el("p", { id: "modalNotice", role: "status", class: "help" });
      $("#modalBody").prepend(local);
    }
    local.textContent = text;
    local.classList.toggle("error", error);
  }
}
export function panel(title, ...content) {
  $("#modalTitle").textContent = title;
  $("#modalBody").replaceChildren(...content.flat());
  if (!$("#modal").open) $("#modal").showModal();
}
export function closePanel() {
  $("#modal").close();
}
export function field(label, name, value = "", type = "text", options = []) {
  let input;
  if (type === "textarea") input = el("textarea", { name, rows: 4, value });
  else if (type === "select") {
    input = el(
      "select",
      { name },
      options.map((o) =>
        el(
          "option",
          { value: typeof o === "string" ? o : o.value },
          typeof o === "string" ? o : o.label,
        ),
      ),
    );
    input.value = value;
  } else
    input = el("input", {
      name,
      type,
      ...(type === "checkbox" ? { checked: !!value } : { value: value ?? "" }),
    });
  if (type === "number") input.step = "any";
  input.setAttribute("aria-label", label);
  return el(
    "label",
    { class: type === "textarea" ? "wide" : "" },
    input.type === "checkbox" ? [input, " " + label] : [label, input],
  );
}
export function values(form) {
  const result = Object.fromEntries(new FormData(form));
  for (const c of form.querySelectorAll("input[type=checkbox]"))
    result[c.name] = c.checked;
  return result;
}
export function formPanel(
  title,
  fields,
  onSave,
  { help = "", submit = "Save" } = {},
) {
  const form = el(
    "form",
    {},
    help ? el("p", { class: "help" }, help) : null,
    el("div", { class: "formgrid" }, fields),
    el(
      "div",
      { class: "actions" },
      el("button", { type: "submit", class: "primary" }, submit),
    ),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = form.querySelector("[type=submit]");
    b.disabled = true;
    try {
      await onSave(values(form));
      closePanel();
    } catch (err) {
      notice(err.message, true);
    } finally {
      b.disabled = false;
    }
  });
  panel(title, form);
  return form;
}
export function confirmation(title, description, onConfirm, label = "Confirm") {
  panel(
    title,
    el("p", {}, description),
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          class: "primary",
          onClick: async () => {
            try {
              await onConfirm();
              closePanel();
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        label,
      ),
      el("button", { onClick: closePanel }, "Cancel"),
    ),
  );
}
