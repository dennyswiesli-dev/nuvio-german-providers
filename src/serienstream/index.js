import { getText, provider, request } from '../../shared/http.js';
import { getMeta } from '../../shared/tmdb.js';
import { load, all } from '../../shared/dom.js';
import { resolveEmbed } from '../../shared/extractors/index.js';
import { bySlug, cookieHeader, followRedirect, pickSeries, splitSeasonPath } from './common.js';

const BASE = 'https://serienstream.to';

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv' || season == null || episode == null) return [];
    try {
        const meta = await getMeta(tmdbId, mediaType);
        let series = null;
        for (const q of meta.titles) {
            const $ = load(await getText(`${BASE}/suche?term=${encodeURIComponent(q)}&tab=shows`, { headers: { Referer: `${BASE}/suche` } }));
            const items = all($, 'a.show-cover').map(a => ({ link: a.attr('href'), title: $('img', a).attr('alt') }));
            if ((series = await pickSeries(items, meta, BASE))) break;
        }
        series = series || await bySlug(BASE, '/serie/', meta);
        if (!series) {
            console.error('[Serienstream] series not found via search or slug');
            return [];
        }
        const episodePage = async path => {
            const epUrl = BASE + path;
            // an episode that does not exist answers 404
            const res = await request(epUrl).catch(() => null);
            // the redirect links may only work with the session cookie of the page that lists them
            const cookie = res ? cookieHeader(res.headers.get('set-cookie')) : '';
            const $ = load(res ? await res.text() : '');
            // "Provider" links always answer 410
            const links = all($, '.link-wrapper button').filter(b => b.attr('data-provider-name') !== 'Provider').map(b => ({
                url: b.attr('data-play-url'), lang: b.attr('data-language-label'), langId: b.attr('data-language-id'),
            }));
            return { epUrl, links, cookie };
        };
        let page = await episodePage(`${series.link}/staffel-${season}/episode-${episode}`);
        if (!page.links.length) {
            const split = await splitSeasonPath(BASE, series.link, season, episode);
            if (split) page = await episodePage(split);
        }
        const { epUrl, links, cookie } = page;
        if (!links.length) console.error(`[Serienstream] no hoster links on ${epUrl}`);
        let redirected = 0;
        // s.to shows a captcha instead of redirecting after ~10 links per IP, so spend links on German first
        // (1 = Deutsch, 3 = Ger-Sub, 2 = Englisch) and only fall back to the next language if nothing played
        for (const langId of ['1', '3', '2']) {
            const out = await Promise.all(links.filter(l => l.langId === langId).map(async l => {
                const embed = await followRedirect(BASE + l.url, epUrl, cookie).catch(() => null);
                if (embed) redirected++;
                return (await resolveEmbed(embed, epUrl)).map(s => ({
                    name: 'Serienstream', title: `${s.host} · ${l.lang}`, url: s.url, quality: s.quality, headers: s.headers,
                }));
            }));
            const streams = [].concat(...out);
            if (streams.length) return streams;
        }
        if (links.length) console.error(`[Serienstream] ${links.length} links, ${redirected} redirected to a hoster, no stream (captcha instead of redirect?)`);
    } catch (e) {
        console.error(`[Serienstream] ${e.message}`);
    }
    return [];
}

module.exports = provider(getStreams);
