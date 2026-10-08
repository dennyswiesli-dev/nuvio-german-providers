#!/usr/bin/env node
// node scripts/debug-sto.js [seriesPath] [season] [episode]
// Diagnostic for s.to's hoster links: shows what the redirect URL (/r?t=...) answers with different request styles.
// Prints status, headers and the beginning of the page, nothing else. Run it from the "Debug Serienstream" workflow.
const cheerio = require('cheerio');

const BASE = 'https://serienstream.to';
const [seriesPath = '/serie/breaking-bad', season = '1', episode = '2'] = process.argv.slice(2);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSER = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin',
};

const cookieOf = res => String(res.headers.get('set-cookie') || '').split(/,(?=\s*[\w.-]+=)/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
const hints = body => ['captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'cloudflare', 'http-equiv="refresh"', 'window.location', 'location.href', 'data-url', 'countdown', 'form'].filter(h => body.toLowerCase().includes(h));

async function show(label, url, opts) {
    console.log(`\n=== ${label}`);
    try {
        const res = await fetch(url, opts);
        const body = await res.text();
        const $ = cheerio.load(body);
        console.log(`status ${res.status}, final url ${res.url.replace(/\?.*/, '?…')}, content-type ${res.headers.get('content-type')}, ${body.length} bytes`);
        console.log(`location: ${res.headers.get('location')}, set-cookie names: ${String(res.headers.get('set-cookie') || '').split(/,(?=\s*[\w.-]+=)/).map(c => c.split('=')[0].trim()).join(', ') || '-'}`);
        console.log(`title: ${$('title').text().trim()}`);
        console.log(`hints: ${hints(body).join(', ') || '-'}`);
        console.log(`headers: ${[...res.headers.entries()].filter(([k]) => k !== 'set-cookie').map(([k, v]) => `${k}: ${v.slice(0, 80)}`).join(' | ')}`);
        // a small interstitial page (like s.to's /r) is worth reading in full; long token strings are masked
        if (body.length <= 4000) console.log(`--- full body ---\n${body.replace(/[A-Za-z0-9+/=_-]{80,}/g, '<token>')}\n--- end ---`);
        console.log(`text: ${$('body').text().replace(/\s+/g, ' ').trim().slice(0, 500)}`);
        const scripts = $('script').map((i, s) => $(s).html() || '').get().filter(s => /location|redirect|captcha|token/i.test(s));
        for (const s of scripts.slice(0, 2)) console.log(`script: ${s.replace(/\s+/g, ' ').slice(0, 400)}`);
        return { res, body, $ };
    } catch (e) {
        console.log(`failed: ${e.message}`);
        return null;
    }
}

(async () => {
    const epUrl = `${BASE}${seriesPath}/staffel-${season}/episode-${episode}`;
    const page = await show('episode page', epUrl, { headers: BROWSER });
    if (!page) return;
    const cookie = cookieOf(page.res);
    const links = page.$('.link-wrapper button').map((i, b) => ({
        provider: page.$(b).attr('data-provider-name'), lang: page.$(b).attr('data-language-label'), url: page.$(b).attr('data-play-url'),
    })).get().filter(l => l.provider !== 'Provider');
    console.log(`\nlinks: ${links.map(l => `${l.provider}/${l.lang}`).join(', ')}`);
    if (!links.length) return;
    const url = BASE + links[0].url;
    console.log(`first link: ${links[0].provider}/${links[0].lang} ${url.replace(/\?.*/, '?…')}`);
    await show('1 plugin style (UA + Referer)', url, { headers: { 'User-Agent': UA, Referer: epUrl } });
    await show('2 plugin style + cookie', url, { headers: { 'User-Agent': UA, Referer: epUrl, Cookie: cookie } });
    await show('3 browser headers + cookie', url, { headers: Object.assign({ Referer: epUrl, Cookie: cookie }, BROWSER) });
    // the page checks window.top === window.self, so it is made for an iframe: ask like an iframe would
    await show('5 iframe style', url, { headers: Object.assign({}, BROWSER, { Referer: epUrl, Cookie: cookie, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' }) });
    await show('4 manual redirect (see Location)', url, { redirect: 'manual', headers: Object.assign({ Referer: epUrl, Cookie: cookie }, BROWSER) });
})();
