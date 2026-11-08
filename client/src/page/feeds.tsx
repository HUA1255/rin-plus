import { useContext, useEffect, useRef, useState } from "react"
import { Helmet } from 'react-helmet'
import { Link, useSearch } from "wouter"
import { FeedCard } from "../components/feed_card"
import { FeedRow, HomeProfile, PinnedFeeds, type HomeFeed } from "../components/home/home-sections"
import { Waiting } from "../components/loading"
import { client } from "../app/runtime"
import { ProfileContext } from "../state/profile"

import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants"
import { tryInt } from "../utils/int"
import { useTranslation } from "react-i18next";

type FeedsData = {
    size: number,
    data: any[],
    hasNext: boolean
}

type FeedType = 'draft' | 'unlisted' | 'normal'

type FeedsMap = {
    [key in FeedType]: FeedsData
}

export function FeedsPage() {
    const { t } = useTranslation()
    const siteConfig = useSiteConfig();
    const query = new URLSearchParams(useSearch());
    const profile = useContext(ProfileContext);
    const [listState, _setListState] = useState<FeedType>(query.get("type") as FeedType || 'normal')
    const [status, setStatus] = useState<'loading' | 'idle'>('idle')
    const [feeds, setFeeds] = useState<FeedsMap>({
        draft: { size: 0, data: [], hasNext: false },
        unlisted: { size: 0, data: [], hasNext: false },
        normal: { size: 0, data: [], hasNext: false }
    })
    const [pinned, setPinned] = useState<HomeFeed[]>([])
    const page = tryInt(1, query.get("page"))
    const limit = tryInt(siteConfig.pageSize, query.get("limit"))
    const isHome = listState === 'normal'
    const feedListClass = siteConfig.feedLayout === "masonry" ? "wauto columns-1 gap-5 ani-show md:columns-2" : "wauto flex flex-col ani-show";
    const currentFeeds = feeds[listState] ?? { size: 0, data: [], hasNext: false };
    const currentFeedData = Array.isArray(currentFeeds.data) ? currentFeeds.data : [];
    const ref = useRef("")
    function fetchFeeds(type: FeedType) {
        client.feed.list({
            page: page,
            limit: limit,
            type: type,
            // The homepage shows pinned posts in their own section, so the normal list leaves them out.
            excludePinned: type === 'normal',
        }).then(({ data }) => {
            if (data) {
                setFeeds((prev) => ({
                    ...prev,
                    [type]: data
                }))
                setStatus('idle')
            }
        })
    }
    useEffect(() => {
        client.feed.pinned().then(({ data }) => {
            if (Array.isArray(data)) setPinned(data as HomeFeed[])
        })
    }, [])
    useEffect(() => {
        const key = `${query.get("page")} ${query.get("type")} ${limit}`
        if (ref.current == key) return
        const type = query.get("type") as FeedType || 'normal'
        if (type !== listState) {
            _setListState(type)
        }
        setStatus('loading')
        fetchFeeds(type)
        ref.current = key
    }, [limit, query.get("page"), query.get("type")])

    const adminLinks = profile?.permission &&
        <div className="flex flex-row space-x-4">
            <Link href={listState === 'draft' ? '/?type=normal' : '/?type=draft'} className={`text-sm text-neutral-500 font-normal ${listState === 'draft' ? "text-theme" : ""}`}>
                {t('draft_bin')}
            </Link>
            <Link href={listState === 'unlisted' ? '/?type=normal' : '/?type=unlisted'} className={`text-sm text-neutral-500 font-normal ${listState === 'unlisted' ? "text-theme" : ""}`}>
                {t('unlisted')}
            </Link>
        </div>

    const pager = (
        <div className="wauto flex flex-row items-center mt-6 ani-show px-4 md:px-0">
            {page > 1 &&
                <Link href={`/?type=${listState}&page=${(page - 1)}`}
                    className={`text-sm font-normal rounded-full px-4 py-2 text-white bg-theme`}>
                    {t('previous')}
                </Link>
            }
            <div className="flex-1" />
            {currentFeeds.hasNext &&
                <Link href={`/?type=${listState}&page=${(page + 1)}`}
                    className={`text-sm font-normal rounded-full px-4 py-2 text-white bg-theme`}>
                    {t('next')}
                </Link>
            }
        </div>
    )

    return (
        <>
            <Helmet>
                <title>{`${t('article.title')} - ${siteConfig.name}`}</title>
                <meta property="og:site_name" content={siteName} />
                <meta property="og:title" content={t('article.title')} />
                <meta property="og:image" content={siteConfig.avatar} />
                <meta property="og:type" content="article" />
                <meta property="og:url" content={document.URL} />
            </Helmet>
            <Waiting for={feeds.draft.size + feeds.normal.size + feeds.unlisted.size > 0 || status === 'idle'}>
                <main className="w-full flex flex-col justify-center items-center mb-8">
                    {isHome ? (
                        <>
                            {page === 1 && <HomeProfile totalCount={currentFeeds.size + pinned.length} />}
                            {page === 1 && <PinnedFeeds feeds={pinned} />}
                            <div className="wauto px-4 md:px-0">
                                <div className="mb-4 flex items-baseline justify-between gap-4">
                                    <h2 className="text-lg font-semibold t-primary">{t('homepage.latest')}</h2>
                                    <div className="flex items-baseline gap-4">
                                        {adminLinks}
                                        <span className="text-sm text-neutral-400">{t('article.total$count', { count: currentFeeds.size })}</span>
                                    </div>
                                </div>
                                <Waiting for={status === 'idle'}>
                                    <div className="flex flex-col ani-show">
                                        {currentFeedData.map((feed: HomeFeed) => (
                                            <FeedRow key={feed.id} feed={feed} />
                                        ))}
                                    </div>
                                </Waiting>
                            </div>
                            {status === 'idle' && pager}
                        </>
                    ) : (
                        <>
                            <div className="wauto text-start text-black dark:text-white py-4 text-4xl font-bold">
                                <p>
                                    {listState === 'draft' ? t('draft_bin') : t('unlisted')}
                                </p>
                                <div className="flex flex-row justify-between mt-4">
                                    <p className="text-sm text-neutral-500 font-normal">
                                        {t('article.total$count', { count: currentFeeds.size })}
                                    </p>
                                    {adminLinks}
                                </div>
                            </div>
                            <Waiting for={status === 'idle'}>
                                <div className={feedListClass}>
                                    {currentFeedData.map(({ id, ...feed }: any) => (
                                        <FeedCard key={id} id={id} {...feed} />
                                    ))}
                                </div>
                                {pager}
                            </Waiting>
                        </>
                    )}
                </main>
            </Waiting>
        </>
    )
}
