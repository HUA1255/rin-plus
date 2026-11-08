import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";
import { resolveSocialLinks, type SocialLink } from "./social-platforms";

export function XiaohongshuIcon({ className = "" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className} width="1em" height="1em">
            <rect x="1.5" y="4" width="21" height="16" rx="4.5" fill="currentColor" />
            <text x="12" y="14.6" textAnchor="middle" fontSize="6.6" fontWeight="700" fill="#fff"
                fontFamily="PingFang SC, Microsoft YaHei, sans-serif">小红书</text>
        </svg>
    );
}

function SocialIcon({ link }: { link: SocialLink }) {
    const style = link.color ? { color: link.color } : undefined;
    if (link.id === "xiaohongshu") {
        return <span className="inline-flex text-lg" style={style}><XiaohongshuIcon /></span>;
    }
    return <i className={`${link.icon} text-lg leading-none`} style={style} aria-hidden="true" />;
}

const pillClass =
    "inline-flex items-center gap-2 rounded-full border border-black/10 bg-w px-4 py-2 text-sm t-primary transition-all duration-200 hover:-translate-y-0.5 hover:border-black/20 dark:border-white/10 dark:hover:border-white/25";

export function SocialLinks() {
    const { t } = useTranslation();
    const config = useContext(ClientConfigContext);
    const links = resolveSocialLinks((key) => config.get(key), config.getBoolean("rss"));
    const [open, setOpen] = useState<SocialLink | null>(null);

    if (links.length === 0) return null;

    return (
        <>
            <ul className="flex flex-wrap justify-center gap-2" aria-label={t("homepage.social.label")}>
                {links.map((link) => (
                    <li key={link.id}>
                        {link.kind === "link" ? (
                            <a href={link.value} target={link.id === "rss" ? undefined : "_blank"} rel="noopener noreferrer" className={pillClass}>
                                <SocialIcon link={link} />
                                {t(`homepage.social.${link.id}`)}
                            </a>
                        ) : (
                            <button type="button" className={pillClass} onClick={() => setOpen(link)} aria-haspopup="dialog">
                                <SocialIcon link={link} />
                                {t(`homepage.social.${link.id}`)}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {/* Portal: an animated (transformed) ancestor would otherwise trap the fixed overlay */}
            {open && createPortal(<ContactDialog link={open} onClose={() => setOpen(null)} />, document.body)}
        </>
    );
}

function ContactDialog({ link, onClose }: { link: SocialLink; onClose: () => void }) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    async function copy() {
        try {
            await navigator.clipboard.writeText(link.value);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 ani-show-fast" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t(`homepage.social.${link.id}`)}
                className="relative w-full max-w-xs rounded-2xl bg-w p-6 text-center t-primary shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <button type="button" onClick={onClose} aria-label={t("close")}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10">
                    <i className="ri-close-line text-lg" aria-hidden="true" />
                </button>
                <div className="mb-3 flex items-center justify-center gap-2 font-semibold">
                    <SocialIcon link={link} />
                    {t(`homepage.social.${link.id}`)}
                </div>
                {link.kind === "qr" ? (
                    <>
                        <img src={link.value} alt={t("homepage.social.wechat_qr_alt")} className="mx-auto w-full max-w-[240px] rounded-xl" />
                        <p className="mt-3 text-sm text-neutral-500">{t("homepage.social.wechat_hint")}</p>
                    </>
                ) : (
                    <>
                        <p className="select-all break-all font-mono text-base">{link.value}</p>
                        <div className="mt-4 flex justify-center gap-2">
                            <button type="button" onClick={copy} className="rounded-full bg-theme px-4 py-2 text-sm text-white">
                                {copied ? t("homepage.social.copied") : t("homepage.social.copy")}
                            </button>
                            <a href={`mailto:${link.value}`} className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15">
                                {t("homepage.social.send_email")}
                            </a>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
