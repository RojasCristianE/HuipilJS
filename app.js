import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";
import sharp from "sharp";

const { TOKEN, DOMAIN, PORT } = process.env;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMG_ROUTE = path.join(__dirname, "public");
const watermarkPath = path.join(IMG_ROUTE, "wm.png");
const watermarkBuffer = await fs.promises.readFile(watermarkPath);

const bot = new TelegramBot(TOKEN);
bot.setWebHook(`${DOMAIN}/bot${TOKEN}`);

const browser = await puppeteer.launch({
    headless: false,
    userDataDir: path.join(__dirname, "chrome_cache")
});
const [page] = await browser.pages();
await page.setViewport({ width: 1366, height: 1000 });
await page.goto("https://kwai-kolors-kolors-virtual-try-on.hf.space/", {
    waitUntil: "networkidle2",
    timeout: 0
});

const app = express();

app.use(express.json());

let processingQueue = [];
let isProcessing = false;

app.listen(PORT, () => console.log(`Express server is listening on ${PORT}`));

const processImage = async (filePath, userId) => {
    try {
        console.log(`Procesando la imagen para el usuario ${userId}`);

        const imgName = path.basename(filePath, ".jpg");
        const garmentIndex = Math.ceil(Math.random() * 10);
        const garmentImagePath = path.join(
            IMG_ROUTE,
            "clothes",
            `${garmentIndex}.png`
        );

        await page.waitForSelector('#component-11 input[type="file"]');
        const personImageInput = await page.$(
            '#component-11 input[type="file"]'
        );
        await personImageInput.uploadFile(filePath);

        await page.waitForSelector('#component-14 input[type="file"]');
        const garmentImageInput = await page.$(
            '#component-14 input[type="file"]'
        );
        await garmentImageInput.uploadFile(garmentImagePath);

        let imgUploadCompleted = false;
        let garmentUploadCompleted = false;
        let notRunYet = true;

        const responseListener = async (response) => {
            const url = response.url();
            if (url.includes("image.webp")) {
                console.log("Imagen generada detectada: " + url);
                page.off("response", responseListener);

                const imageResponse = await axios({
                    url,
                    method: "GET",
                    responseType: "arraybuffer",
                });

                const imageBuffer = Buffer.from(imageResponse.data);
                const image = sharp(imageBuffer);
                const watermark = sharp(watermarkBuffer);

                const { width } = await image.metadata();
                const input = await watermark.resize({ width }).toBuffer();
                const finalImage = await image
                    .composite([{ input, gravity: "south" }])
                    .toFormat("jpg")
                    .toBuffer();

                await bot.sendPhoto(userId, finalImage, {
                    caption: "Aquí tenés tu foto. ¡Perdón por la demora!",
                });

                const transformedImgPath = path.join(
                    IMG_ROUTE,
                    "transformed",
                    `${imgName}.jpg`
                );
                await fs.promises.writeFile(transformedImgPath, finalImage);

                await page.reload();

                imgUploadCompleted = false;
                garmentUploadCompleted = false;
                notRunYet = true;

                processNextImage();
            }

            if (!imgUploadCompleted)
                imgUploadCompleted = url.includes(`${imgName}.jpg`);
            if (!garmentUploadCompleted)
                garmentUploadCompleted = url.includes(`${garmentIndex}.png`);

            const bothImgUploaded =
                imgUploadCompleted && garmentUploadCompleted;

            if (bothImgUploaded && notRunYet) {
                notRunYet = false;
                await page.waitForSelector("#button");
                const runButton = await page.$("#button");
                await runButton.click();
            }
        };

        page.on("response", responseListener);
    } catch (error) {
        console.error("Error procesando la imagen:", filePath);
        processNextImage();
    }
};

const processNextImage = () => {
    if (processingQueue.length > 0) {
        const { filePath, userId } = processingQueue.shift();
        processImage(filePath, userId);
    } else {
        isProcessing = false;
    }
};

const addImageToQueue = (filePath, userId) => {
    processingQueue.push({ filePath, userId });

    if (!isProcessing) {
        isProcessing = true;
        processNextImage();
    }
};

const processPendingImages = () => {
    fs.readdir(path.join(IMG_ROUTE, "users"), (err, files) => {
        files.forEach((file) => {
            const userId = file.split("_")[0];
            const filePath = path.join(IMG_ROUTE, "users", file);
            addImageToQueue(filePath, userId);
        });
    });
};

processPendingImages();