/**
 * Admin → Types de produits.
 *
 * Product types used to be a hardcoded array in `src/lib/catalog.ts`, so adding
 * one meant a deploy. They now live in the `productCategories` table and this
 * panel is their only writer; the same rows feed the product form, the home
 * tiles and the search filter.
 *
 * Two rules the UI makes visible because the server enforces them anyway:
 *  - an icon must come from the allow-list, so the picker only ever offers
 *    names the mutation will accept;
 *  - a type still in use cannot be deleted. The mutation deactivates it
 *    instead and says so, and the row here flips to "inactive" so the admin
 *    sees the real outcome rather than a silent no-op.
 */

import { createElement, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Pencil, Plus, Power, Trash2, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { iconForKey } from "@/components/CategoryIcon";
import { cn } from "@/lib/utils";

type CategoryRow = Doc<"productCategories">;

const inputClass =
  "tap-target w-full rounded-lg border border-border bg-background px-2 text-sm text-start outline-none focus:border-brand-green";

/** Blank edit state for the add form. */
function blankForm(order: number) {
  return { key: "", ar: "", fr: "", icon: "Package", order: String(order), parent: "" };
}

type FormState = ReturnType<typeof blankForm>;

export function AdminCategories() {
  const { t, lang } = useLang();
  const rows = useQuery(api.adminCategories.listAdmin);
  const iconKeys = useQuery(api.adminCategories.iconKeys);
  const usage = useQuery(api.adminCategories.usage);
  const createCategory = useMutation(api.adminCategories.create);
  const updateCategory = useMutation(api.adminCategories.update);
  const setActive = useMutation(api.adminCategories.setActive);
  const removeCategory = useMutation(api.adminCategories.remove);
  const ensureDefaults = useMutation(api.adminCategories.ensureDefaults);

  const [busy, setBusy] = useState(false);
  // `null` = the add form is closed. A key string = that row is being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const icons = iconKeys ?? ["Package"];
  const list = rows ?? [];

  const nextOrder = list.reduce((max, row) => Math.max(max, row.order), -1) + 1;

  const startAdd = () => {
    setForm(blankForm(nextOrder));
    setEditing("__new__");
  };

  const startEdit = (row: CategoryRow) => {
    setForm({
      key: row.key,
      ar: row.ar,
      fr: row.fr,
      icon: row.icon,
      order: String(row.order),
      parent: row.parent ?? "",
    });
    setEditing(row.key);
  };

  const close = () => {
    setEditing(null);
    setForm(null);
  };

  const save = async () => {
    if (!form) return;
    if (!form.ar.trim() || !form.fr.trim()) {
      toast.error(t.errRequired);
      return;
    }
    setBusy(true);
    try {
      const shared = {
        ar: form.ar.trim(),
        fr: form.fr.trim(),
        icon: form.icon,
        order: Number(form.order) || 0,
        ...(form.parent ? { parent: form.parent } : {}),
      };
      if (editing === "__new__") {
        await createCategory({ key: form.key.trim().toLowerCase(), ...shared });
        toast.success(t.save);
      } else if (editing) {
        await updateCategory({ key: editing, active: true, ...shared });
        toast.success(t.save);
      }
      close();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: CategoryRow) => {
    setBusy(true);
    try {
      await setActive({ key: row.key, active: !row.active });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const del = async (row: CategoryRow) => {
    setBusy(true);
    try {
      const result = await removeCategory({ key: row.key });
      if (result.deleted) toast.success(t.catAdminDeleted);
      else toast.warning(t.catAdminDeactivatedInstead);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    try {
      const result = await ensureDefaults();
      toast.success(`${t.catAdminSeeded} (${result.created})`);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-neutral-600">{t.catAdminIntro}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startAdd}
          className="tap-target inline-flex items-center gap-1.5 rounded-lg bg-[#006233] px-3 text-sm font-semibold text-white"
        >
          <Plus className="size-4" aria-hidden />
          {t.catAdminAdd}
        </button>
        {list.length === 0 && (
          <button
            type="button"
            onClick={seed}
            disabled={busy}
            className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-[#006233] px-3 text-sm font-semibold text-[#006233] disabled:opacity-50"
          >
            <Sparkles className="size-4" aria-hidden />
            {t.catAdminSeedDefaults}
          </button>
        )}
      </div>

      {/* Add / edit form. Mounted only while open so a stale form can never
          shadow the list. */}
      {editing && form && (
        <div className="rounded-lg border border-[#e3e8e5] bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-black">
            {editing === "__new__" ? t.catAdminAdd : t.catAdminEdit}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.catAdminKey}
              </span>
              <input
                className={inputClass}
                value={form.key}
                disabled={editing !== "__new__"}
                dir="ltr"
                onChange={(e) => setForm({ ...form, key: e.target.value })}
              />
              <span className="mt-1 block text-[11px] text-neutral-500">
                {t.catAdminKeyHint}
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.catAdminOrder}
              </span>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.order}
                onChange={(e) => setForm({ ...form, order: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.catAdminAr}
              </span>
              <input
                className={inputClass}
                dir="rtl"
                value={form.ar}
                onChange={(e) => setForm({ ...form, ar: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.catAdminFr}
              </span>
              <input
                className={inputClass}
                dir="ltr"
                value={form.fr}
                onChange={(e) => setForm({ ...form, fr: e.target.value })}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.catAdminParent}
              </span>
              <select
                className={inputClass}
                value={form.parent}
                onChange={(e) => setForm({ ...form, parent: e.target.value })}
              >
                <option value="">{t.catAdminParentNone}</option>
                {list
                  .filter((row) => row.key !== editing && !row.parent)
                  .map((row) => (
                    <option key={row.key} value={row.key}>
                      {lang === "ar" ? row.ar : row.fr}
                    </option>
                  ))}
              </select>
            </label>

            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.catAdminIcon}
              </span>
              <div className="flex flex-wrap gap-2">
                {icons.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setForm({ ...form, icon: name })}
                    aria-label={name}
                    aria-pressed={form.icon === name}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-lg border transition-colors",
                      form.icon === name
                        ? "border-[#006233] bg-[#eef6f1] text-[#006233]"
                        : "border-[#e3e8e5] bg-white text-neutral-500 hover:border-[#006233]",
                    )}
                  >
                    {createElement(iconForKey(name), {
                      width: 20,
                      height: 20,
                      strokeWidth: 1.75,
                      "aria-hidden": true,
                    })}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="tap-target inline-flex items-center rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t.catAdminSave}
            </button>
            <button
              type="button"
              onClick={close}
              className="tap-target inline-flex items-center rounded-lg border border-[#e3e8e5] px-4 text-sm font-semibold text-neutral-700"
            >
              {t.catAdminCancel}
            </button>
          </div>
        </div>
      )}

      {rows === undefined ? (
        <p className="text-sm text-neutral-500">{t.loading}</p>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-[#e3e8e5] bg-white p-4 text-sm text-neutral-600">
          {t.catAdminEmpty}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[#e3e8e5] bg-white p-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef6f1] text-[#006233]">
                {createElement(iconForKey(row.icon) as LucideIcon, {
                  width: 18,
                  height: 18,
                  strokeWidth: 1.75,
                  "aria-hidden": true,
                })}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-black">
                  {lang === "ar" ? row.ar : row.fr}
                </p>
                <p className="truncate text-xs text-neutral-500" dir="ltr">
                  {row.key}
                  {row.parent
                    ? ` · ${t.catAdminSubOf.replace("{parent}", row.parent)}`
                    : ""}
                </p>
              </div>
              <span className="text-xs text-neutral-500">
                {t.catAdminProducts.replace("{n}", String(usage?.[row.key] ?? 0))}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  row.active
                    ? "bg-[#eef6f1] text-[#006233]"
                    : "bg-neutral-100 text-neutral-500",
                )}
              >
                {row.active ? t.catAdminActive : t.catAdminInactive}
              </span>
              <div className="flex items-center gap-1">
                <IconButton
                  label={t.catAdminEdit}
                  onClick={() => startEdit(row)}
                  disabled={busy}
                >
                  <Pencil className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={row.active ? t.adminHide : t.adminActivate}
                  onClick={() => toggle(row)}
                  disabled={busy}
                >
                  <Power className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={t.catAdminDelete}
                  onClick={() => del(row)}
                  disabled={busy}
                  danger
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Icon-only action button: still carries its name for screen readers. */
function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "tap-target inline-flex size-10 items-center justify-center rounded-lg border transition-colors disabled:opacity-50",
        danger
          ? "border-transparent text-red-600 hover:border-red-200 hover:bg-red-50"
          : "border-transparent text-neutral-500 hover:border-[#e3e8e5] hover:text-[#006233]",
      )}
    >
      {children}
    </button>
  );
}

/** Map a server error code to a sentence the admin can act on. */
function errorMessage(err: unknown, t: Record<string, string>): string {
  const code = err instanceof Error ? err.message : "";
  switch (code) {
    case "errCategoryNameEmpty":
    case "errCategoryNameTooLong":
      return t.errRequired;
    default:
      return t.errGeneric;
  }
}
