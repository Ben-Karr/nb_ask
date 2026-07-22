import * as vscode from 'vscode';
import express, { NextFunction, type Express, type Request, type Response } from 'express';
import { Server } from 'http';
import { createHash } from 'crypto';


let server: Server | undefined;
let _default_port: number = 3144;
let port: number = _default_port;


let pendingMoves: { movedCellId: string; linkedCellId: string; linkedCellData: vscode.NotebookCellData; type: string }[] = [];
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
	const newMetadata = { ...activeCell.metadata, precedingCellsHash, uuid: existingId ?? crypto.randomUUID() };

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

async function insertResponse(content: any, targetCellId: string) {
	const editor = vscode.window.activeNotebookEditor;
	if (!editor) {
		return 400;
	}
	const nb = editor.notebook;
	const targetCellIndex = nb.getCells().findIndex(c => c.metadata.uuid === targetCellId);

	const kind = vscode.NotebookCellKind.Markup;
	const edit = new vscode.WorkspaceEdit();
	const cellData = new vscode.NotebookCellData(
		kind,
		content,
		"markdown",
	);
	const responseId = crypto.randomUUID();
	cellData.metadata = { requestId: targetCellId, uuid: responseId };
	edit.set(nb?.uri, [
		vscode.NotebookEdit.insertCells(targetCellIndex + 1, [cellData]),
		vscode.NotebookEdit.updateCellMetadata(targetCellIndex, { ...nb.cellAt(targetCellIndex).metadata, responseId })
	]);

	const success = await vscode.workspace.applyEdit(edit);
	return success ? 200 : 500;
}

function startServer(port: number) {
	if (server === undefined) {
		const app: Express = express();

		app.get("/", async (req: Request, res: Response) => {
			res.json(await getCellsContent());
		});

		app.use(express.json());

		app.post("/insert_response", async (req: Request, res: Response) => {
			const { content, targetCellHash } = req.body;
			const status = await insertResponse(content, targetCellHash);
			res.status(status).send();
		});

		server = app.listen(port, "127.0.0.1", () => {
			console.log(`NBAsk services provided on port: ${port}`);
		});
	}
	else {
		console.log(`NBAsk server already running at ${port}`);
	};
}

function stopServer() {
	if (server === undefined) {
		console.log("No NBAsk server running...");
	}
	else {
		console.log("Closing NBAsk server...");
		server.close();
		server = undefined;
	};
}

function maybeRestartServer(port: number) {
	if (server !== undefined) {
		console.log(`Restart NBAsk server with new port: ${port}`);
		stopServer();
		startServer(port);
	};
}

export function activate(context: vscode.ExtensionContext) {
	// Keep that as comment, maybe want to add this back in later...
	/*context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.set_token', async () => {
			const token = await vscode.window.showInputBox({ prompt: 'Enter token', password: true });
			if (token) {
				await context.secrets.store('nb_ask.token', token);
			};
		})
	);
	*/
	console.log("Activating nb_ask extension...");
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.set_port', async () => {
			let _port = (await vscode.window.showInputBox({ prompt: 'Enter port:' })) ?? '3001';
			let parsedPort = parseInt(_port, 10);
			if (isNaN(parsedPort)) {
				vscode.window.showErrorMessage(`Invalid port number: ${_port}`, { modal: true });
				return;
			}
			port = parsedPort;
			maybeRestartServer(port);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.start', async () => {
			startServer(port);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.stop', async () => {
			stopServer();
		})
	);

	vscode.workspace.onDidChangeNotebookDocument(e => {
		const editor = vscode.window.activeNotebookEditor;
		if (!editor) {
			return;
		};
		const nb = editor.notebook;
		const edit = new vscode.WorkspaceEdit();
		for (const change of e.contentChanges) {
			for (const removedCell of change.removedCells) {
				maybeStoreLinkedCell(removedCell, nb);
			}

			for (const addedCell of change.addedCells) {
				maybeMoveLinkedCell(addedCell, nb, edit);
			}
		}
	});

}

async function maybeMoveLinkedCell(addedCell: vscode.NotebookCell, nb: vscode.NotebookDocument, edit: vscode.WorkspaceEdit) {
	const pendingMove = pendingMoves.find(m => m.movedCellId === addedCell.metadata.uuid);
	if (pendingMove) {
		const linkedCellIdx = nb.getCells().findIndex(c => c.metadata.uuid === pendingMove.linkedCellId);
		const insertIdx = pendingMove.type === "request" ? addedCell.index + 1 : addedCell.index - 1;
		edit.set(nb.uri, [
			vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(linkedCellIdx, linkedCellIdx + 1)),
			vscode.NotebookEdit.insertCells(insertIdx, [pendingMove.linkedCellData])
		]);
		await vscode.workspace.applyEdit(edit);
		pendingMoves = pendingMoves.filter(m => m.movedCellId !== addedCell.metadata.uuid);
	}
}

function maybeStoreLinkedCell(removedCell: vscode.NotebookCell, nb: vscode.NotebookDocument) {
	if (pendingMoves.some(m => m.linkedCellId === removedCell.metadata.uuid)) { return; }
	let type: string;
	let linkedCellId: string;
	if ('requestId' in removedCell.metadata) {
		type = 'response';
		linkedCellId = removedCell.metadata.requestId;
	}
	else if ('responseId' in removedCell.metadata) {
		type = 'request';
		linkedCellId = removedCell.metadata.responseId;
	}
	else { return; };
	const linkedCellIdx = nb.getCells().findIndex(c => c.metadata.uuid === linkedCellId);
	const linkedCell = nb.cellAt(linkedCellIdx);
	const linkedCellData = new vscode.NotebookCellData(
		linkedCell.kind,
		linkedCell.document.getText(),
		linkedCell.document.languageId,
	);
	linkedCellData.metadata = linkedCell.metadata;

	pendingMoves.push({ movedCellId: removedCell.metadata.uuid, linkedCellId, linkedCellData, type });
}

export function deactivate() {
	stopServer();
}
