import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST,
	port: Number(process.env.SMTP_PORT ?? 465),
	secure: Number(process.env.SMTP_PORT ?? 465) === 465,
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
	},
});

export const sendMail = async (input: {
	to: string;
	subject: string;
	html: string;
	text: string;
}) => {
	await transporter.sendMail({
		from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
		to: input.to,
		subject: input.subject,
		html: input.html,
		text: input.text,
	});
};
