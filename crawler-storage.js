const puppeteer = require("puppeteer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csvParse = require("csv-parse");
const fs = require("fs");

const API_KEY = "YOUR-SUPER-SECRET-API-KEY";

async function writeToCsv(data, outputFile) {
    if (!data || data.length === 0) {
        throw new Error("No data to write!");
    }
    const fileExists = fs.existsSync(outputFile);

    const headers = Object.keys(data[0]).map(key => ({id: key, title: key}))

    const csvWriter = createCsvWriter({
        path: outputFile,
        header: headers,
        append: fileExists
    });
    try {
        await csvWriter.writeRecords(data);
    } catch (e) {
        throw new Error("Failed to write to csv");
    }
}

async function resultCrawl(browser, productName, pageNumber, location="us", retries=3) {
    let tries = 0;
    let success = false;

    while (tries < retries && !success) {
        const page = await browser.newPage();
        try {
            const url = `https://www.amazon.com/s?k=${productName}&page=${pageNumber}`;
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

                    await writeToCsv([item], `${productName}.csv`);

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

function range(start, end) {
    const array = [];
    for (let i=start; i<end; i++) {
        array.push(i);
    }
    return array;
}

async function concurrentCrawl(browser, query, pages, location="us", retries=3) {
    console.log("Concurrent crawl started");
    const pageList = range(1, pages+1);

    for (const page of pageList) {
        await resultCrawl(browser, query, location, retries);
    }
    console.log("Concurrent crawl finished");
}


async function main() {
    const PRODUCTS = ["phone"];
    const MAX_RETRIES = 4;
    const PAGES = 1;
    const LOCATION = "us";


    for (const product of PRODUCTS) {
        const browser = await puppeteer.launch();
        await concurrentCrawl(browser, product, PAGES, LOCATION, MAX_RETRIES);
        await browser.close();

    }
}


main();