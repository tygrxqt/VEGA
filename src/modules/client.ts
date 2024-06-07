import { ChannelType, Client, Collection, EmbedBuilder, Message, User } from "discord.js";

import type { DiscordCommand } from "../types/command";
import type { DiscordEvent } from "../types/event";

import { readdirSync } from "fs";
import path from "path";

import { Connectors } from "shoukaku";
import { Kazagumo, Plugins } from "kazagumo";

import Spotify from "kazagumo-spotify"
import Apple from "kazagumo-apple";
import KazagumoFilter from "kazagumo-filter";
import stringToBoolean from "../lib/string-to-bool";

class VEGA extends Client {
	public commands: Collection<string, DiscordCommand> = new Collection();
	public events: Collection<string, DiscordEvent<never>> = new Collection();
	public prefix: string = process.env.PREFIX as string;
	public kazagumo: Kazagumo = new Kazagumo({
		defaultSearchEngine: "youtube",
		send: (guildId, payload) => {
			const guild = this.guilds.cache.get(guildId);
			if (guild) guild.shard.send(payload);
		},
		plugins: [
			new Spotify({
				clientId: process.env.SPOTIFY_CLIENT_ID as string,
				clientSecret: process.env.SPOTIFY_CLIENT_SECRET as string,
			}),
			new Apple({
				countryCode: "us",
				imageWidth: 600,
				imageHeight: 900
			}),
			new KazagumoFilter(),
			new Plugins.PlayerMoved(this)
		]
	}, new Connectors.DiscordJS(this), [process.env.NODE_ENV === "development" ? {
		name: "lavalink4.alfari.id",
		url: "lavalink4.alfari.id:443",
		auth: "catfein",
		secure: true,
	} : {
		name: process.env.LAVALINK_NAME as string,
		url: process.env.LAVALINK_HOST as string + ":" + process.env.LAVALINK_PORT as string,
		auth: process.env.LAVALINK_PASSWORD as string,
		secure: stringToBoolean(process.env.LAVALINK_SECURE as string)
	}]);

	public async start() {
		// Discord Event Handler
		const eventsPath = path.join(__dirname, "..", "events");

		readdirSync(eventsPath).filter((file) => file.endsWith(".ts")).forEach(async (file) => {
			const { event }: { event: DiscordEvent<never> } = await import(`${eventsPath}/${file}`);
			this.events.set(event.name, event);
			this.on(event.name, event.cmd.bind(null, this));
			console.log(`Successfully loaded ${event.name} event.`)
		});

		// Commands Handler
		const commandsPath = path.join(__dirname, "..", "commands");

		readdirSync(commandsPath).forEach(async (dir) => {
			const commands = readdirSync(`${commandsPath}/${dir}`).filter((file) => file.endsWith(".ts"));

			for (const file of commands) {
				const { command }: { command: DiscordCommand } = await import(`${commandsPath}/${dir}/${file}`);
				this.commands.set(command.name, command);
				console.log(`Successfully loaded ${command.name} command.`)
			}
		});

		// Music events
		this.kazagumo.shoukaku.on('ready', () => console.log(`Connected to LavaLink server!`));
		this.kazagumo.shoukaku.on('error', (name, error) => console.error(`Lavalink ${name}: Error Caught,`, error));
		this.kazagumo.shoukaku.on('close', (name, code, reason) => console.warn(`Lavalink ${name}: Closed, Code ${code}, Reason ${reason || 'No reason'}`));
		this.kazagumo.shoukaku.on('disconnect', (name) => {
			const players = [...this.kazagumo.shoukaku.players.values()].filter(p => p.node.name === name);
			players.map(player => {
				this.kazagumo.destroyPlayer(player.guildId);
				player.destroy();
			});
			console.warn(`Lavalink ${name}: Disconnected`);
		});

		if (process.env.NODE_ENV === "development") {
			this.kazagumo.shoukaku.on('debug', (name, info) => console.debug(`Lavalink ${name}: Debug,`, info));
		}

		// Player events
		this.kazagumo.on("playerStart", (player, track) => {
			const channel = this.channels.cache.get(player.textId as string);
			if (!channel) return;

			if (channel.type === ChannelType.GuildText) {
				const embed = new EmbedBuilder()
					.setTitle("Now Playing: **" + track.title + "**");

				if (typeof track.uri !== "undefined") embed.setURL(track.uri);
				if (typeof track.requester !== "undefined") {
					const req = track.requester as User;
					embed.setDescription(`Requested by: **${req.username}**`)
				}

				const existingMessage: Message | undefined = player.data.get("message");

				if (typeof existingMessage !== "undefined") {
					return existingMessage.edit({ embeds: [embed] });
				} else {
					return channel.send({ embeds: [embed] }).then(x => player.data.set("message", x));
				}
			}
		});

		this.kazagumo.on("playerEmpty", player => {
			const channel = this.channels.cache.get(player.textId as string);
			if (!channel) return player.destroy();

			if (channel.type === ChannelType.GuildText) {
				const embed = new EmbedBuilder()
					.setDescription("The queue has ended")
				player.data.get("message")?.edit({ embeds: [embed] });
			}
			player.destroy();
		});

		await this.login(process.env.DISCORD_TOKEN as string);
	}
}

export default VEGA;