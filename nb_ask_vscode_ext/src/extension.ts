import * as vscode from 'vscode';
import express, { type Express, type Request, type Response } from 'express';
import { Server } from 'http';
import { createHash } from 'crypto';
import { editOutputCommand } from './editOutput';
import { NbAskSettingsViewProvider, DEFAULT_PORT, TOKEN_SECRET_KEY } from './settingsView';


let server: Server | undefined;
let port: number;


interface CellContent {
	index: number;
	kind: 'code' | 'markdown';
	source: string;
	outputs: string[];
}

async function updateCellMetadata(
	precedingCells: CellContent[],
	activeCellIndex: number,
	nb: vscode.NotebookDocument) {
	if (nb.cellCount === 0) {
		return { activeCellId: '', precedingCellsHash: '' };
	};
	const precedingCellsHash = createHash('sha256').update(JSON.stringify(precedingCells)).digest("hex");
	const activeCell = nb.cellAt(activeCellIndex);
	const existingId = activeCell.metadata.uuid;
	console.log("existingId: ", existingId);
	const newMetadata = { ...activeCell.metadata, precedingCellsHash, uuid: existingId ?? crypto.randomUUID() };
	console.log({ newMetadata });

	const edit = new vscode.WorkspaceEdit();
	edit.set(nb.uri, [vscode.NotebookEdit.updateCellMetadata(activeCellIndex, newMetadata)]);
	await vscode.workspace.applyEdit(edit);
	return { activeCellId: newMetadata.uuid, precedingCellsHash };
}

async function getCellsContent() {
	const editor = vscode.window.activeNotebookEditor;
	if (!editor) {
		return;
	};
	const nb = editor.notebook;
	const activeCellIndex = editor?.selection.start ?? 0;
	console.log("activeCellIndex: ", activeCellIndex);
	const precedingCells = nb.getCells()
		.slice(0, activeCellIndex)
		.map((cell, index): CellContent => ({
			index,
			kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
			source: cell.document.getText(),
			outputs: cell.outputs.map(o => o.items.map(i => Buffer.from(i.data).toString()).join(''))
		}));
	const { activeCellId, precedingCellsHash } = await updateCellMetadata(precedingCells, activeCellIndex, nb);

	return { precedingCellsHash, precedingCells, activeCellId };
}

function startServer(port: number, context: vscode.ExtensionContext) {
	if (server !== undefined) { return; }
	const app: Express = express();

	app.get("/", async (req: Request, res: Response) => {
		res.json(await getCellsContent());
	});
	app.use(express.json());

	app.get("/config", async (req: Request, res: Response) => {
		const token = await context.secrets.get(TOKEN_SECRET_KEY);
		const cfg = vscode.workspace.getConfiguration('nbAsk');
		res.json({
			model: cfg.get<string>('model', ''),
			endpoint: 'https://openrouter.ai/api/v1',
			token: token ?? null,
			port,
		});
	});

	const s = app.listen(port, "127.0.0.1", () => {
		console.log(`NBAsk server on port ${port}`);
		server = s;
	});
	s.on('error', (e: any) => {
		console.log(`NBAsk server failed on ${port}: ${e.message}`);
		server = undefined;   // stay consistent, don't half-start
	});
}

function stopServer(): Promise<void> {
	return new Promise(resolve => {
		if (server === undefined) { resolve(); return; }
		server.close(() => resolve());   // callback fires once port is released
		server = undefined;
	});
}

async function restartServer(port: number, context: vscode.ExtensionContext) {
	if (server !== undefined) {
		console.log(`Restart NBAsk server on port ${port}`);
		await stopServer();
	}
	startServer(port, context);
}


export function activate(context: vscode.ExtensionContext) {
	console.log("Activating nb_ask extension...");

	port = vscode.workspace.getConfiguration('nbAsk').get<number>('port', DEFAULT_PORT);
	startServer(port, context);

	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.start', async () => {
			startServer(port, context);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.stop', async () => {
			stopServer();
		})
	);
	context.subscriptions.push(editOutputCommand(context));

	const provider = new NbAskSettingsViewProvider(context, async (p: number) => { await restartServer(p, context); });
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(NbAskSettingsViewProvider.viewId, provider)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.open_settings', () => {
			vscode.commands.executeCommand('nbAsk.settingsView.focus');
		})
	);
}

export function deactivate() {
	stopServer();
}
