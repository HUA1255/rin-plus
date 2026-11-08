import type { QueueTask } from "./queue";

declare global {
  interface Env {
    TASK_QUEUE?: Queue<QueueTask>;
    R2_BUCKET?: R2Bucket;
    /** 站点公开访问地址（可选）。未设置时 sitemap/robots 回退到请求来源 origin */
    FRONTEND_URL?: string;
    /** RSS 开关。false/0/off 时不提供 /rss.xml 等订阅地址 */
    RSS_ENABLE?: string;
  }
}

export {};
