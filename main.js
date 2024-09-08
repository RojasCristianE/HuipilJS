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

const browser = await puppeteer.launch({userDataDir: path.join(__dirname, "chrome_cache")});
const [page] = await browser.pages();
await page.setViewport({ width: 1366, height: 800 });
await page.goto("https://kwai-kolors-kolors-virtual-try-on.hf.space/", {
    waitUntil: "networkidle2",
    timeout: 0,
});

const app = express();

app.use(express.json());

let isProcessing = false;
let lastErrorTime = 0;
let WAIT_TIME = 600000;

app.post(`/bot${TOKEN}`, ({body}, res) => {
	bot.processUpdate(body);
	res.sendStatus(200)
});

app.listen(PORT, () => console.log(`Express server is listening on ${PORT}`));

bot.on(
    "message",
    async ({ message_id, text, photo, from: { id, username, first_name } }) => {
        console.log("\n" + new Date().toLocaleString());
        console.log(`Procesando mensaje de: tg://user?id=${id}`);

        const currentTime = Date.now();
        const recentError = currentTime - lastErrorTime < WAIT_TIME;

        if (recentError) {
            await bot.sendMessage(
                id,
                "Actualmente estamos procesando una alta cantidad de solicitudes. Intenta nuevamente en unos minutos. ¡Gracias por tu paciencia!"
            );

            return;
        }

        if (isProcessing) {
            await bot.sendMessage(
                id,
                "Estoy procesando otra solicitud en este momento. Intenta de nuevo en unos minutos."
            );

            return;
        }

        if (/^\/start/.test(text))
            bot.sendMessage(
                id,
                `¡Hola, ${first_name}! Envíame una foto y te mostraré cómo te verías con un tradicional huipil.`
            );
        else if (photo) {
            console.log("Foto recibida");

            await bot.sendMessage(
                id,
                "¡Linda foto!\n\nAhora solo espera unos minutos para recibir tu foto"
            );
            isProcessing = true;

            let url;

            try {
                const photoId = photo[photo.length - 1].file_id;
                const uPhoto = await bot.getFile(photoId);
                const imgName = `${username || id}_${message_id}`;
                const usrImgPath = path.join(
                    IMG_ROUTE,
                    "users",
                    `${imgName}.jpg`
                );
                const writer = fs.createWriteStream(usrImgPath);

                url = `https://api.telegram.org/file/bot${TOKEN}/${uPhoto.file_path}`;
                const usrImgResponse = await axios({
                    url,
                    method: "GET",
                    responseType: "stream",
                });
                usrImgResponse.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on("finish", resolve);
                    writer.on("error", reject);
                });

                const i = Math.ceil(Math.random() * 10);

                const garmentImagePath = path.join(
                    IMG_ROUTE,
                    "clothes",
                    `${i}.png`
                );

                await page.waitForSelector('#component-11 input[type="file"]');
                const personImageInput = await page.$(
                    '#component-11 input[type="file"]'
                );
                await personImageInput.uploadFile(usrImgPath);

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

					if (!imgUploadCompleted) {
                        imgUploadCompleted =
                            imgUploadCompleted ||
                            url.includes(`${imgName}.jpg`);
					}

                    if (!garmentUploadCompleted) {
						garmentUploadCompleted =
							garmentUploadCompleted || url.includes(`${i}.png`);
					}

                    const bothImgUploaded =
                        imgUploadCompleted && garmentUploadCompleted;

                    if (bothImgUploaded && notRunYet) {
                        notRunYet = false;

                        await page.waitForSelector("#button");
                        const runButton = await page.$("#button");
                        await runButton.click();
                    }

					if (url.includes("image.webp")) {
                        page.off("response", responseListener);
                        console.log("Listener de respuestas desactivado.");

                        const imageResponse = await axios({
                            url,
                            method: "GET",
                            responseType: "arraybuffer",
                        });

                        const imageBuffer = Buffer.from(imageResponse.data);
                        const image = sharp(imageBuffer);
                        const watermark = sharp(watermarkBuffer);

                        const { width } = await image.metadata();

                        const input = await watermark
                            .resize({ width })
                            .toBuffer();

                        const finalImage = await image
                            .composite([{ input, gravity: "south" }])
                            .toFormat("jpg")
                            .toBuffer();

                        await bot.sendPhoto(id, finalImage, {
                            caption:
                                "Aquí tenés tu foto.\n\n¡Feliz día del Huipil!",
                        });

                        const transformedImgPath = path.join(
                            IMG_ROUTE,
                            "transformed",
                            `${imgName}.jpg`
                        );
                        await fs.promises.writeFile(
                            transformedImgPath,
                            finalImage
                        );

                        await page.reload();

                        imgUploadCompleted = false;
                        garmentUploadCompleted = false;
						notRunYet = true;

                        isProcessing = false;
                    }
                };

                page.on("response", responseListener);
            } catch (error) {
                lastErrorTime = currentTime;

                await bot.sendMessage(
                    id,
                    "Actualmente estamos procesando una alta cantidad de solicitudes. Intenta nuevamente en unos minutos. ¡Gracias por tu paciencia!"
                );
            }
        } else
            bot.sendMessage(
                id,
                "¡Lo siento! Solo puedo procesar comandos o fotos."
            );
    }
);
