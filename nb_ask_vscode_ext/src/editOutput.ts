import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

let outputPanel: vscode.WebviewPanel | undefined;
let editingTarget: { notebookUri: vscode.Uri; cellUuid: string } | undefined;

export function getCellOutputText(cell: vscode.NotebookCell): string {
    const last = cell.outputs[cell.outputs.length - 1];
    if (!last) { return ''; }
    const md = last.items.filter(i => i.mime === 'text/markdown');
    const plain = last.items.filter(i => i.mime === 'text/plain');
    if (md.length > 0) {
        return md.map(i => Buffer.from(i.data).toString('utf8')).join('\n\n');
    }
    return plain.map(i => Buffer.from(i.data).toString('utf8')).join('\n\n');
}



function editorHtml(webview: vscode.Webview, initialContent: string, extensionPath: string): string {
    const nonce = Math.random().toString(36).slice(2);
    const cssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'media', 'editor.css')
    );
    return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy"
	      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${cssUri}">
</head>
<body>
	<header>
		<button id="save">Save</button>
		<span id="info"></span>
	</header>
	<main><textarea id="out" spellcheck="false"></textarea></main>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const out = document.getElementById('out');
		out.value = ${JSON.stringify(initialContent).replace(/</g, '\\u003c')};
		document.getElementById('save').onclick = () =>
			vscode.postMessage({ type: 'saveOutput', content: out.value });
		out.addEventListener('input', () => {
			document.getElementById('info').textContent = '';
		});
	</script>
</body>
</html>`;
}

async function saveOutputAsCellReplacement(
    nb: vscode.NotebookDocument,
    cellUuid: string,
    newContent: string
): Promise<boolean> {
    const idx = nb.getCells().findIndex(c => c.metadata.uuid === cellUuid);
    if (idx === -1) {
        vscode.window.showErrorMessage('Target cell no longer exists.');
        return false;
    }
    const cell = nb.cellAt(idx);

    // keep all outputs, replace only the last one
    const outputs = cell.outputs.map((o, i) =>
        i < cell.outputs.length - 1
            ? o                                                        // untouched
            : new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(newContent, 'text/markdown')
            ])
    );
    if (cell.outputs.length === 0) {
        outputs.push(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(newContent, 'text/markdown')
        ]));
    }

    const newCell = new vscode.NotebookCellData(cell.kind, cell.document.getText(), cell.document.languageId);

    newCell.outputs = outputs;
    newCell.metadata = cell.metadata;

    const edit = new vscode.WorkspaceEdit();
    edit.set(nb.uri, [
        vscode.NotebookEdit.replaceCells(
            new vscode.NotebookRange(idx, idx + 1),
            [newCell]
        )
    ]);
    return vscode.workspace.applyEdit(edit);
}

async function editOutput(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || editor.selections.length === 0) {
        vscode.window.showErrorMessage('Select a cell first.');
        return;
    }
    const cell = editor.notebook.cellAt(editor.selections[0].start);
    const uuid: string | undefined = cell.metadata.uuid;
    if (!uuid) {
        vscode.window.showErrorMessage('Cell has no uuid (ask on this cell first).');
        return;
    }

    const content = getCellOutputText(cell) || '### 🤖 (no output yet — dummy text)';

    if (outputPanel) {
        outputPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        outputPanel = vscode.window.createWebviewPanel(
            'nbask.outputEditor',
            'NbAsk Output Editor',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
        outputPanel.onDidDispose(() => {
            outputPanel = undefined;
            editingTarget = undefined;
        });
        outputPanel.webview.onDidReceiveMessage(async msg => {
            if (msg.type !== 'saveOutput' || !editingTarget) { return; }
            const nb = vscode.workspace.notebookDocuments.find(
                n => n.uri.toString() === editingTarget!.notebookUri.toString()
            );
            if (!nb) {
                vscode.window.showErrorMessage('Notebook is no longer open.');
                return;
            }
            const ok = await saveOutputAsCellReplacement(nb, editingTarget.cellUuid, msg.content);
            if (ok) {
                vscode.window.showInformationMessage('Response output updated.');
                outputPanel?.dispose();
            } else {
                vscode.window.showErrorMessage('Saving failed.');
            }
        });
    }

    editingTarget = { notebookUri: editor.notebook.uri, cellUuid: uuid };
    outputPanel.title = 'NbAsk Output Editor';
    outputPanel.webview.html = editorHtml(outputPanel.webview, content, context.extensionPath);
}

export function editOutputCommand(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('nb_ask.edit_output', () => editOutput(context));
}