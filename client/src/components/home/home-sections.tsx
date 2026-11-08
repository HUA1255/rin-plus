import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import { ClientConfigContext } from "../../state/config";
import { timeago } from "../../utils/timeago";
import { FeedCardImage } from "../feed_card";
import { HashTag } from "../hashtag";
import { SocialLinks } from "./social-links";

export type HomeFeed = {
    id: number | string;
    title: string | null;
    summary: string;
    avatar?: string | null;
    hashtags?: { id: number; name: string }[];
    createdAt: string | Date;
    draft?: number;
    listed?: number;
};

function FeedDate({ value }: { value: string | Date }) {
    const date = new Date(value);
    return (
        <time dateTime={date.toISOString()} title={date.toLocaleString()} className="text-xs tabular-nums text-neutral-400">
            {timeago(date)}
        </time>
    );
}

function Cover({ feed, className }: { feed: HomeFeed; className: string }) {
    if (feed.avatar) {
        return <FeedCardImage src={feed.avatar} variant="default" frameClassName={className} />;
    }
    return (
        <div aria-hidden="true"
            className={`flex items-center justify-center bg-neutral-100 font-serif text-2xl text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500 ${className}`}>
            {(feed.title ?? "").slice(0, 1)}
        </div>
    );
}

export function HomeProfile({ totalCount }: { totalCount: number }) {
    const { t } = useTranslation();
    const siteConfig = useSiteConfig();
    const config = useContext(ClientConfigContext);
    const name = String(config.get("profile.name") ?? "").trim() || siteConfig.name;
    const subname = String(config.get("profile.subname") ?? "").trim();

    return (
        <section className="wauto flex flex-col items-center gap-3 px-4 pb-10 pt-6 text-center ani-show" aria-label={t("homepage.profile_label")}>
            {siteConfig.avatar && (
                <img src={siteConfig.avatar} alt={name}
                    className="h-24 w-24 rounded-full border-4 border-white object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)] dark:border-neutral-800" />
            )}
            <h1 className="text-3xl font-bold tracking-tight t-primary text-balance">
                {name}
                {subname && <span className="ml-2 text-base font-normal text-neutral-400">{subname}</span>}
            </h1>
            {siteConfig.description && (
                <p className="max-w-xl text-base text-neutral-500 dark:text-neutral-400">{siteConfig.description}</p>
            )}
            <div className="mt-1">
                <SocialLinks />
            </div>
            <p className="text-xs text-neutral-400">{t("homepage.stats$count", { count: totalCount })}</p>
        </section>
    );
}

export function PinnedFeeds({ feeds }: { feeds: HomeFeed[] }) {
    const { t } = useTranslation();
    if (feeds.length === 0) return null;
    const featureFirst = feeds.length === 1 || feeds.length === 3;
    const gridClass = feeds.length === 1
        ? "grid-cols-1"
        : feeds.length === 3
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]"
            : "grid-cols-1 sm:grid-cols-2";

    return (
        <section className="wauto mb-10 px-4 ani-show" aria-labelledby="home-pinned-title">
            <div className="mb-4 flex items-baseline justify-between">
                <h2 id="home-pinned-title" className="flex items-center gap-2 text-lg font-semibold t-primary">
                    <i className="ri-pushpin-2-line text-theme" aria-hidden="true" />
                    {t("homepage.pinned")}
                </h2>
            </div>
            <div className={`grid gap-4 ${gridClass}`}>
                {feeds.map((feed, index) => {
                    const lead = featureFirst && index === 0;
                    return (
                        <Link key={feed.id} href={`/feed/${feed.id}`} target="_blank" rel="noopener noreferrer"
                            className={`group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-w transition-shadow hover:shadow-lg dark:border-white/10 ${lead && feeds.length === 3 ? "sm:col-span-2 lg:col-span-1" : ""}`}>
                            <Cover feed={feed} className="aspect-[16/9]" />
                            <div className="flex flex-col gap-2 px-4 pb-4 pt-3">
                                <FeedDate value={feed.createdAt} />
                                <h3 className={`font-semibold leading-snug t-primary text-balance group-hover:text-theme ${lead ? "text-lg" : "text-base"}`}>
                                    {feed.title}
                                </h3>
                                <p className="line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">{feed.summary}</p>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}

export function FeedRow({ feed }: { feed: HomeFeed }) {
    const { t } = useTranslation();
    const hashtags = Array.isArray(feed.hashtags) ? feed.hashtags : [];
    return (
        <Link href={`/feed/${feed.id}`} target="_blank" rel="noopener noreferrer"
            className="group grid grid-cols-[minmax(0,1fr)_92px] items-center gap-4 border-t border-black/10 py-5 last:border-b dark:border-white/10 sm:grid-cols-[minmax(0,1fr)_168px] sm:gap-5">
            <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <FeedDate value={feed.createdAt} />
                    {feed.draft === 1 && <span className="text-xs text-neutral-400">{t("draft")}</span>}
                    {feed.listed === 0 && <span className="text-xs text-neutral-400">{t("unlisted")}</span>}
                </div>
                <h3 className="break-words text-base font-semibold leading-snug t-primary group-hover:text-theme sm:text-lg [overflow-wrap:anywhere]">
                    {feed.title}
                </h3>
                <div className="hidden sm:block">
                    <p className="line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">{feed.summary}</p>
                </div>
                {hashtags.length > 0 && (
                    <div className="mt-1 hidden flex-wrap gap-2 sm:flex">
                        {hashtags.map(({ name }) => <HashTag key={name} name={name} />)}
                    </div>
                )}
            </div>
            <Cover feed={feed} className="aspect-[16/10] rounded-xl" />
        </Link>
    );
}
