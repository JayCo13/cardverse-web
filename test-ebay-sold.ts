import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
    const url = 'https://www.ebay.com/sch/i.html?_nkw=topps+chrome+soccer+2025&_sacat=0&_from=R40&LH_Sold=1&LH_Complete=1&_pgn=1&rt=nc';
    try {
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const $ = cheerio.load(html);
        console.log("Total items:", $('.s-item').length);
        const first = $('.s-item').eq(1); // 0 is usually the "Shop on eBay" header
        console.log("Title text:", first.find('.s-item__title').text().trim());
        console.log("Price text:", first.find('.s-item__price').text().trim());
        console.log("Link:", first.find('.s-item__link').attr('href'));
    } catch (e) {
        console.error(e);
    }
}
test();
