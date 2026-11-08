import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "@rin/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../app/runtime";

type PinnedItem = { id: number; title: string | null };

export function moveItem<T>(items: T[], from: number, to: number): T[] {
    if (to < 0 || to >= items.length || from === to) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

/** Reorders pinned posts. Each change is saved right away. */
export function PinnedOrderSettings({ onError }: { onError: (message: string) => void }) {
    const { t } = useTranslation();
    const [items, setItems] = useState<PinnedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        client.feed.pinned().then(({ data, error }) => {
            if (error) onError(error.value);
            if (Array.isArray(data)) setItems(data.map(({ id, title }) => ({ id, title })));
            setLoading(false);
        });
    }, []);

    async function save(next: PinnedItem[]) {
        const previous = items;
        setItems(next);
        setSaving(true);
        const { error } = await client.feed.setPinnedOrder(next.map((item) => item.id));
        setSaving(false);
        if (error) {
            setItems(previous);
            onError(error.value);
        }
    }

    const iconButton = "flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10";

    return (
        <div className="w-full">
            <SettingsCard>
                <SettingsCardHeader title={t("settings.home.pinned.title")} description={t("settings.home.pinned.desc")} />
                <SettingsCardBody>
                    {loading ? null : items.length === 0 ? (
                        <p className="text-sm text-neutral-500">{t("settings.home.pinned.empty")}</p>
                    ) : (
                        <ol className="flex flex-col gap-1" aria-busy={saving}>
                            {items.map((item, index) => (
                                <li key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                                    <span className="w-5 text-center text-sm tabular-nums text-neutral-400">{index + 1}</span>
                                    <a href={`/feed/${item.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm t-primary hover:text-theme">
                                        {item.title || `#${item.id}`}
                                    </a>
                                    <button type="button" className={iconButton} disabled={saving || index === 0}
                                        aria-label={t("settings.home.pinned.up")} title={t("settings.home.pinned.up")}
                                        onClick={() => save(moveItem(items, index, index - 1))}>
                                        <i className="ri-arrow-up-line" aria-hidden="true" />
                                    </button>
                                    <button type="button" className={iconButton} disabled={saving || index === items.length - 1}
                                        aria-label={t("settings.home.pinned.down")} title={t("settings.home.pinned.down")}
                                        onClick={() => save(moveItem(items, index, index + 1))}>
                                        <i className="ri-arrow-down-line" aria-hidden="true" />
                                    </button>
                                    <button type="button" className={iconButton} disabled={saving}
                                        aria-label={t("settings.home.pinned.remove")} title={t("settings.home.pinned.remove")}
                                        onClick={() => save(items.filter((_, i) => i !== index))}>
                                        <i className="ri-close-line" aria-hidden="true" />
                                    </button>
                                </li>
                            ))}
                        </ol>
                    )}
                </SettingsCardBody>
            </SettingsCard>
        </div>
    );
}
