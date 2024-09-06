import { Client } from "@gradio/client";

const person = await fetch("https://huipil.jscomunicadores.com/public/users/1725048833377.jpg");
const person_img = await person.blob();
const garment = await fetch("https://huipil.jscomunicadores.com/public/clothes/huipil.jpg");
const garment_img = await garment.blob();
const seed = 0;
const randomize_seed = true;

const client = await Client.connect("Kwai-Kolors/Kolors-Virtual-Try-On");
const result = await client.predict(
    "/tryon",
    {
        person_img,
        garment_img,
        seed,
        randomize_seed,
    }
);

console.log(result.data);