const puppeteer = require("puppeteer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csvParse = require("csv-parse");
const fs = require("fs");

const API_KEY = "YOUR-SUPER-SECRET-API-KEY";

async function resultCrawl(browser, productName, retries=3) {
    let tries = 0;
    let success = false;

    while (tries < retries && !success) {
        const page = await browser.newPage();
        try {
            const url = `https://www.amazon.com/s?k=${productName}`;
            await page.goto(url);

            console.log(`Successfully fetched page: ${pageNumber}`);

            const badDivs = await page.$$("div.AdHolder");

            for (const div of badDivs) {
                await page.evaluate(element => {
                    element.parentNode.removeChild(element);
                }, div);
            }

            const divs = await page.$$("div > span > div");
            console.log(`Div count: ${divs.length}`);

            let lastTitle = "";

            for (const div of divs) {
                const h2 = await div.$("h2");
                if (h2 === null) {
                    continue;
                }
                const a = await h2.$("a");

                const parsable = h2 !== null && a !== null;
                

                if (parsable) {
                    const title = await page.evaluate(element => element.textContent, h2);
                    if (title === lastTitle) {
                        continue;
                    }
                    console.log(`Title: ${title}`);                    
                
                    const productUrl = await page.evaluate(a => {
                        const url = a.getAttribute("href");
                        if (url.includes("https")) {
                            return url;
                        } else {
                            return `https://www.amazon.com${url}`;
                        }
                    }, a);
                    console.log(`Product url: ${productUrl}`);

                    const adStatus = productUrl.includes("sspa");
                    console.log(`Ad Status: ${adStatus}`);

                    const urlArray = productUrl.split("/");
                    const asin = urlArray[urlArray.length-2];
                    console.log(`Asin: ${asin}`);

                    const pricingUnit = await div.$("span.a-price-symbol");
                    const wholePrice = await div.$("span.a-price-whole");
                    const decimalPrice = await div.$("span.a-price-fraction");

                    if (pricingUnit === null || wholePrice === null || decimalPrice === null) {
                        console.log("Failed to find price!");
                        continue;
                    }

                    
                    const priceSymbol = await page.evaluate(pricingUnit => pricingUnit.textContent, pricingUnit);
                    const wholeNumber = await page.evaluate(wholePrice => wholePrice.textContent, wholePrice);
                    const decimalNumber = await page.evaluate(decimalPrice => decimalPrice.textContent, decimalPrice)
                    
                    const formattedWholeNumber = wholeNumber.replace(",", "").replace(".", "");
                    const price = Number(`${formattedWholeNumber}.${decimalNumber}`);

                    const realPricePresence = await div.$("span.a-price.a-text-price span");
                    let realPrice = 0.0;

                    if (realPricePresence !== null) {
                        const realPriceStr = await page.evaluate(realPricePresence => realPricePresence.textContent, realPricePresence);
                        realPrice = Number(realPriceStr.replace(priceSymbol, ""));

                    } else {
                        realPrice = price;
                    }
                   
                    let rating = "n/a";
                    ratingPresence = await div.$("span.a-icon-alt");
                    if (ratingPresence !== null) {
                        rating = await page.evaluate(ratingPresence => ratingPresence.textContent, ratingPresence);
                    }
                    

                    const item = {
                        asin: asin,
                        title: title,
                        url: productUrl,
                        is_ad: adStatus,
                        pricing_unit: priceSymbol,
                        price: price,
                        real_price: realPrice,
                        rating: rating
                    }


                    console.log("Item:", item);

                    lastTitle = title;
                }
            }

            success = true;

        } catch (err) {
            console.log(`ERROR: ${err}, PAGE ${pageNumber}`);
            tries++;
        } finally {
            await page.close();
            if (success) {
                console.log(`Finished scraping page: ${pageNumber}`);
            }
        }
    }
}


async function main() {
    const PRODUCTS = ["phone"];
    const MAX_RETRIES = 4;
    


    for (const product of PRODUCTS) {
        const browser = await puppeteer.launch();
        await resultCrawl(browser, product, MAX_RETRIES)
        await browser.close();

    }
}


main();