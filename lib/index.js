"use strict";
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = __importDefault(require("fs-extra"));
const lodash_kebabcase_1 = __importDefault(require("lodash.kebabcase"));
const path_1 = __importDefault(require("path"));
const remark_admonitions_1 = __importDefault(require("remark-admonitions"));
const utils_1 = require("@docusaurus/utils");
const blogUtils_1 = require("./blogUtils");
const DEFAULT_OPTIONS = {
    path: 'blog',
    routeBasePath: 'blog',
    include: ['*.md', '*.mdx'],
    postsPerPage: 10,
    blogListComponent: '@theme/BlogListPage',
    blogPostComponent: '@theme/BlogPostPage',
    blogTagsListComponent: '@theme/BlogTagsListPage',
    blogTagsPostsComponent: '@theme/BlogTagsPostsPage',
    showReadingTime: true,
    remarkPlugins: [],
    rehypePlugins: [],
    editUrl: undefined,
    truncateMarker: /<!--\s*(truncate)\s*-->/,
    admonitions: {},
};
function assertFeedTypes(val) {
    if (typeof val !== 'string' && !['rss', 'atom', 'all'].includes(val)) {
        throw new Error(`Invalid feedOptions type: ${val}. It must be either 'rss', 'atom', or 'all'`);
    }
}
const getFeedTypes = (type) => {
    assertFeedTypes(type);
    let feedTypes = [];
    if (type === 'all') {
        feedTypes = ['rss', 'atom'];
    }
    else {
        feedTypes.push(type);
    }
    return feedTypes;
};
function pluginContentBlog(context, opts) {
    const options = Object.assign(Object.assign({}, DEFAULT_OPTIONS), opts);
    if (options.admonitions) {
        options.remarkPlugins = options.remarkPlugins.concat([
            [remark_admonitions_1.default, opts.admonitions || {}],
        ]);
    }
    const { siteDir, generatedFilesDir } = context;
    const contentPath = path_1.default.resolve(siteDir, options.path);
    const dataDir = path_1.default.join(generatedFilesDir, 'docusaurus-plugin-content-blog');
    let blogPosts = [];
    return {
        name: 'docusaurus-plugin-content-blog',
        getPathsToWatch() {
            const { include = [] } = options;
            const globPattern = include.map((pattern) => `${contentPath}/${pattern}`);
            return [...globPattern];
        },
        getClientModules() {
            const modules = [];
            if (options.admonitions) {
                modules.push(require.resolve('remark-admonitions/styles/infima.css'));
            }
            return modules;
        },
        // Fetches blog contents and returns metadata for the necessary routes.
        async loadContent() {
            const { postsPerPage, routeBasePath } = options;
            blogPosts = await blogUtils_1.generateBlogPosts(contentPath, context, options);
            if (!blogPosts.length) {
                return null;
            }
            // Colocate next and prev metadata.
            blogPosts.forEach((blogPost, index) => {
                const prevItem = index > 0 ? blogPosts[index - 1] : null;
                if (prevItem) {
                    blogPost.metadata.prevItem = {
                        title: prevItem.metadata.title,
                        permalink: prevItem.metadata.permalink,
                    };
                }
                const nextItem = index < blogPosts.length - 1 ? blogPosts[index + 1] : null;
                if (nextItem) {
                    blogPost.metadata.nextItem = {
                        title: nextItem.metadata.title,
                        permalink: nextItem.metadata.permalink,
                    };
                }
            });
            // Blog pagination routes.
            // Example: `/blog`, `/blog/page/1`, `/blog/page/2`
            const totalCount = blogPosts.length;
            const numberOfPages = Math.ceil(totalCount / postsPerPage);
            const { siteConfig: { baseUrl = '' }, } = context;
            const basePageUrl = utils_1.normalizeUrl([baseUrl, routeBasePath]);
            const blogListPaginated = [];
            function blogPaginationPermalink(page) {
                return page > 0
                    ? utils_1.normalizeUrl([basePageUrl, `page/${page + 1}`])
                    : basePageUrl;
            }
            for (let page = 0; page < numberOfPages; page += 1) {
                blogListPaginated.push({
                    metadata: {
                        permalink: blogPaginationPermalink(page),
                        page: page + 1,
                        postsPerPage,
                        totalPages: numberOfPages,
                        totalCount,
                        previousPage: page !== 0 ? blogPaginationPermalink(page - 1) : null,
                        nextPage: page < numberOfPages - 1
                            ? blogPaginationPermalink(page + 1)
                            : null,
                    },
                    items: blogPosts
                        .slice(page * postsPerPage, (page + 1) * postsPerPage)
                        .map((item) => item.id),
                });
            }
            const blogTags = {};
            const tagsPath = utils_1.normalizeUrl([basePageUrl, 'tags']);
            blogPosts.forEach((blogPost) => {
                const { tags } = blogPost.metadata;
                if (!tags || tags.length === 0) {
                    // TODO: Extract tags out into a separate plugin.
                    // eslint-disable-next-line no-param-reassign
                    blogPost.metadata.tags = [];
                    return;
                }
                // eslint-disable-next-line no-param-reassign
                blogPost.metadata.tags = tags.map((tag) => {
                    if (typeof tag === 'string') {
                        const normalizedTag = lodash_kebabcase_1.default(tag);
                        const permalink = utils_1.normalizeUrl([tagsPath, normalizedTag]);
                        if (!blogTags[normalizedTag]) {
                            blogTags[normalizedTag] = {
                                // Will only use the name of the first occurrence of the tag.
                                name: tag.toLowerCase(),
                                items: [],
                                permalink,
                            };
                        }
                        blogTags[normalizedTag].items.push(blogPost.id);
                        return {
                            label: tag,
                            permalink,
                        };
                    }
                    else {
                        return tag;
                    }
                });
            });
            const blogTagsListPath = Object.keys(blogTags).length > 0 ? tagsPath : null;
            return {
                blogPosts,
                blogListPaginated,
                blogTags,
                blogTagsListPath,
            };
        },
        async contentLoaded({ content: blogContents, actions, }) {
            if (!blogContents) {
                return;
            }
            const { blogListComponent, blogPostComponent, blogTagsListComponent, blogTagsPostsComponent, } = options;
            const aliasedSource = (source) => `~blog/${path_1.default.relative(dataDir, source)}`;
            const { addRoute, createData } = actions;
            const { blogPosts, blogListPaginated, blogTags, blogTagsListPath, } = blogContents;
            const blogItemsToMetadata = {};
            // Create routes for blog entries.
            await Promise.all(blogPosts.map(async (blogPost) => {
                const { id, metadata } = blogPost;
                await createData(
                // Note that this created data path must be in sync with
                // metadataPath provided to mdx-loader.
                `${utils_1.docuHash(metadata.source)}.json`, JSON.stringify(metadata, null, 2));
                addRoute({
                    path: metadata.permalink,
                    component: blogPostComponent,
                    exact: true,
                    modules: {
                        content: metadata.source,
                    },
                });
                blogItemsToMetadata[id] = metadata;
            }));
            // Create routes for blog's paginated list entries.
            await Promise.all(blogListPaginated.map(async (listPage) => {
                const { metadata, items } = listPage;
                const { permalink } = metadata;
                const pageMetadataPath = await createData(`${utils_1.docuHash(permalink)}.json`, JSON.stringify(metadata, null, 2));
                addRoute({
                    path: permalink,
                    component: blogListComponent,
                    exact: true,
                    modules: {
                        items: items.map((postID) => {
                            const metadata = blogItemsToMetadata[postID];
                            // To tell routes.js this is an import and not a nested object to recurse.
                            return {
                                content: {
                                    __import: true,
                                    path: metadata.source,
                                    query: {
                                        truncated: true,
                                    },
                                },
                            };
                        }),
                        metadata: aliasedSource(pageMetadataPath),
                    },
                });
            }));
            // Tags.
            if (blogTagsListPath === null) {
                return;
            }
            const tagsModule = {};
            await Promise.all(Object.keys(blogTags).map(async (tag) => {
                const { name, items, permalink } = blogTags[tag];
                tagsModule[tag] = {
                    allTagsPath: blogTagsListPath,
                    slug: tag,
                    name,
                    count: items.length,
                    permalink,
                };
                const tagsMetadataPath = await createData(`${utils_1.docuHash(permalink)}.json`, JSON.stringify(tagsModule[tag], null, 2));
                addRoute({
                    path: permalink,
                    component: blogTagsPostsComponent,
                    exact: true,
                    modules: {
                        items: items.map((postID) => {
                            const metadata = blogItemsToMetadata[postID];
                            return {
                                content: {
                                    __import: true,
                                    path: metadata.source,
                                    query: {
                                        truncated: true,
                                    },
                                },
                            };
                        }),
                        metadata: aliasedSource(tagsMetadataPath),
                    },
                });
            }));
            // Only create /tags page if there are tags.
            if (Object.keys(blogTags).length > 0) {
                const tagsListPath = await createData(`${utils_1.docuHash(`${blogTagsListPath}-tags`)}.json`, JSON.stringify(tagsModule, null, 2));
                addRoute({
                    path: blogTagsListPath,
                    component: blogTagsListComponent,
                    exact: true,
                    modules: {
                        tags: aliasedSource(tagsListPath),
                    },
                });
            }
        },
        configureWebpack(_config, isServer, { getBabelLoader, getCacheLoader }) {
            const { rehypePlugins, remarkPlugins, truncateMarker } = options;
            return {
                resolve: {
                    alias: {
                        '~blog': dataDir,
                    },
                },
                module: {
                    rules: [
                        {
                            test: /(\.mdx?)$/,
                            include: [contentPath],
                            use: [
                                getCacheLoader(isServer),
                                getBabelLoader(isServer),
                                {
                                    loader: require.resolve('@docusaurus/mdx-loader'),
                                    options: {
                                        remarkPlugins,
                                        rehypePlugins,
                                        // Note that metadataPath must be the same/in-sync as
                                        // the path from createData for each MDX.
                                        metadataPath: (mdxPath) => {
                                            const aliasedSource = utils_1.aliasedSitePath(mdxPath, siteDir);
                                            return path_1.default.join(dataDir, `${utils_1.docuHash(aliasedSource)}.json`);
                                        },
                                    },
                                },
                                {
                                    loader: path_1.default.resolve(__dirname, './markdownLoader.js'),
                                    options: {
                                        siteDir,
                                        contentPath,
                                        truncateMarker,
                                        blogPosts,
                                    },
                                },
                            ].filter(Boolean),
                        },
                    ],
                },
            };
        },
        async postBuild({ outDir }) {
            var _a;
            if (!options.feedOptions) {
                return;
            }
            const feed = await blogUtils_1.generateBlogFeed(context, options);
            if (!feed) {
                return;
            }
            const feedTypes = getFeedTypes((_a = options.feedOptions) === null || _a === void 0 ? void 0 : _a.type);
            await Promise.all(feedTypes.map((feedType) => {
                const feedPath = path_1.default.join(outDir, options.routeBasePath, `${feedType}.xml`);
                const feedContent = feedType === 'rss' ? feed.rss2() : feed.atom1();
                try {
                    fs_extra_1.default.writeFileSync(feedPath, feedContent);
                }
                catch (err) {
                    throw new Error(`Generating ${feedType} feed failed: ${err}`);
                }
            }));
        },
        injectHtmlTags() {
            var _a;
            if (!options.feedOptions) {
                return {};
            }
            const feedTypes = getFeedTypes((_a = options.feedOptions) === null || _a === void 0 ? void 0 : _a.type);
            const { siteConfig: { title }, baseUrl, } = context;
            const feedsConfig = {
                rss: {
                    type: 'application/rss+xml',
                    path: 'rss.xml',
                    title: `${title} Blog RSS Feed`,
                },
                atom: {
                    type: 'application/atom+xml',
                    path: 'atom.xml',
                    title: `${title} Blog Atom Feed`,
                },
            };
            const headTags = [];
            feedTypes.map((feedType) => {
                const feedConfig = feedsConfig[feedType] || {};
                if (!feedsConfig) {
                    return;
                }
                const { type, path, title } = feedConfig;
                headTags.push({
                    tagName: 'link',
                    attributes: {
                        rel: 'alternate',
                        type,
                        href: utils_1.normalizeUrl([baseUrl, options.routeBasePath, path]),
                        title,
                    },
                });
            });
            return {
                headTags,
            };
        },
    };
}
exports.default = pluginContentBlog;
