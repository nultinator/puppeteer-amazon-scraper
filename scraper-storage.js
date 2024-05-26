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

async function readCsv(inputFile) {
    const results = [];
    const parser = fs.createReadStream(inputFile).pipe(csvParse.parse({
        columns: true,
        delimiter: ",",
        trim: true,
        skip_empty_lines: true
    }));

    for await (const record of parser) {
        results.push(record);
    }
    return results;
}

function getScrapeOpsUrl(url, location="us") {
    const params = new URLSearchParams({
        api_key: API_KEY,
        url: url,
        country: location
    });
    return `https://proxy.scrapeops.io/v1/?${params.toString()}`;
}

async function resultCrawl(browser, productName, pageNumber, location="us", retries=3) {
    let tries = 0;
    let success = false;

    while (tries < retries && !success) {
        const page = await browser.newPage();
        try {
            const url = `https://www.amazon.com/s?k=${productName}&page=${pageNumber}`;
            const proxyUrl = getScrapeOpsUrl(url, location);
            console.log(proxyUrl);
            await page.goto(proxyUrl);

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

async function concurrentCrawl(browser, query, pages, concurrencyLimit, location="us", retries=3) {
    console.log("Concurrent crawl started");
    const pageList = range(1, pages+1);

    while (pageList.length > 0) {
        const currentBatch = pageList.splice(0, concurrencyLimit);
        const tasks = currentBatch.map(page => resultCrawl(browser, query, page, location, retries));

        try {
            await Promise.all(tasks);
        } catch (e) {
            console.log(`Failed to process batch: ${e}`);
        }
    }
    console.log("Concurrent crawl finished");
}

async function parseProduct(browser, productObject, location="us", retries=3) {
    const productUrl = productObject.url;

    let tries = 0;
    let success = false;

    const urlArray = productUrl.split("/");
    const title = urlArray[urlArray.length-4];
    const asin = urlArray[urlArray.length-2];

    while (tries <= retries && !success) {
        const page = await browser.newPage();
        try {
            await page.goto(productUrl, {timeout: 60000});
            const imagesToSave = [];
            const features = [];

            const images = await page.$$("li img");
            for (const image of images) {
                const imageLink = await page.evaluate(element => element.getAttribute("src"), image);
                if (imageLink.includes("https://m.media-amazon.com/images/I/")) {
                    imagesToSave.push(imageLink);
                }
            }

            const featureBullets = await page.$$("li.a-spacing-mini");
            for (const feature of featureBullets) {
                const span = await feature.$("span");
                const text = await page.evaluate(span => span.textContent, span);
                if (!features.includes(text)) {
                    features.push(text);
                }
            }

            const priceSymbolElement = await page.$("span.a-price-symbol");
            const priceWholeElement = await page.$("span.a-price-whole");
            const priceDecimalElement = await page.$("span.a-price-fraction");

            const priceSymbol = await page.evaluate(element => element.textContent, priceSymbolElement);
            const priceWhole = (await page.evaluate(element => element.textContent, priceWholeElement)).replace(",", "").replace(".", "");
            const priceDecimal = await page.evaluate(element => element.textContent, priceDecimalElement);

            const price = Number(`${priceWhole}.${priceDecimal}`);
            if (imagesToSave.length > 0) {
                const item = {
                    asin: asin,
                    title: title,
                    url: productUrl,
                    pricing_unit: priceSymbol,
                    price: price,
                    feature_1: features[0],
                    feature_2: features[1],
                    feature_3: features[2],
                    feature_4: features[3],
                    images_1: imagesToSave[0],
                    images_2: imagesToSave[1],
                    images_3: imagesToSave[2],
                    images_4: imagesToSave[3]
                }

                await writeToCsv([item], `${item.title}.csv`);
                console.log("Wrote to csv");
                success = true;
            } else {
                await page.screenshot({path: `ERROR-${title}.png`});
                throw new Error("Failed to find item details!");
            }


        } catch (e) {
            console.log("ERROR:", e);
            await page.screenshot({path: "error.png", fullPage: true});
            console.log(`Failed page, Tries left: ${retries-tries}`);
            tries++;

        } finally {
            await page.close();
        }
    }
    return;
}

async function concurrentProductScrape(browser, inputFile, concurrencyLimit, location="us", retries=3) {
    const productObjects = await readCsv(inputFile);

    for (const productObject of productObjects) {
        await parseProduct(browser, productObject, location, retries);
    }
    

}


async function main() {
    const PRODUCTS = ["phone"];
    const MAX_RETRIES = 4;
    const PAGES = 5;
    const CONCURRENCY_LIMIT = 4;
    const LOCATION = "us";


    for (const product of PRODUCTS) {
        const browser = await puppeteer.launch();
        const fileName = `./${product}.csv`;
        await concurrentCrawl(browser, product, PAGES, CONCURRENCY_LIMIT, LOCATION, MAX_RETRIES);
        await concurrentProductScrape(browser, fileName, CONCURRENCY_LIMIT, LOCATION, MAX_RETRIES);
        await browser.close();

    }
}


main();