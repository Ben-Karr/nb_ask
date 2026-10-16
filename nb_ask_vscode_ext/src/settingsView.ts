import * as vscode from 'vscode';

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const TOKEN_SECRET_KEY = 'nb_ask.token';
export const DEFAULT_PORT = 3144;


interface OpenRouterModel { id?: string; name?: string }
interface ModelListResponse {
	data?: OpenRouterModel[];
}
export interface SettingsMessage {
	type: 'getInitialValues' | 'save' | 'fetchModels' | 'reloadServer';
	token?: string;
	model?: string;
	port?: number;
}
export interface ModelOption { value: string; label: string }

export async function getModels(): Promise<ModelOption[]> {
	const res = await fetch(OPENROUTER_MODELS_URL, { headers: { Accept: 'application/json' } });
	if (!res.ok) { throw new Error(`Provider returned ${res.status} ${res.statusText}`); }
	const body = await res.json() as ModelListResponse;
	return (body.data ?? [])
		.filter(m => typeof m.id === 'string' && m.id.length > 0)
		.map(m => ({ value: `openrouter/${m.id!}`, label: m.name ?? m.id! }))
		.sort((a, b) => a.value.localeCompare(b.value));
}

export class NbAskSettingsViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'nbAsk.settingsView';

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly reloadServer: (port: number) => void
	) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (msg: SettingsMessage) => {
			switch (msg.type) {
				case 'getInitialValues': {
					const cfg = vscode.workspace.getConfiguration('nbAsk');
					let port = cfg.get<number>('port');
					if (port === undefined) {
						port = DEFAULT_PORT;
						// write once so it persists; never overwrites an existing value
						await cfg.update('port', port, vscode.ConfigurationTarget.Global);
					}
					const hasToken = (await this.context.secrets.get(TOKEN_SECRET_KEY)) !== undefined;
					await webviewView.webview.postMessage({
						type: 'initialValues',
						port,
						model: cfg.get<string>('model', ''),
						hasToken,
					});
					break;
				}
				case 'save': {
					await this.save(msg, webviewView);
					break;
				}
				case 'fetchModels': {
					try {
						const models = await getModels();
						await webviewView.webview.postMessage({ type: 'models', models });
					} catch (e) {
						await webviewView.webview.postMessage({
							type: 'modelsError',
							error: e instanceof Error ? e.message : String(e),
						});
					}
					break;
				}
				case 'reloadServer': {
					const cfg = vscode.workspace.getConfiguration('nbAsk');
					this.reloadServer(cfg.get<number>('port', DEFAULT_PORT));
					await webviewView.webview.postMessage({ type: 'serverReloaded' });
					break;
				}
			}
		});
	}

	private async save(msg: SettingsMessage, webviewView: vscode.WebviewView): Promise<void> {
		try {
			// token: only overwrite when the user actually typed something
			if (msg.token !== undefined && msg.token.length > 0) {
				await this.context.secrets.store(TOKEN_SECRET_KEY, msg.token);
			}
			const cfg = vscode.workspace.getConfiguration('nbAsk');
			if (msg.model !== undefined) {
				await cfg.update('model', msg.model, vscode.ConfigurationTarget.Global);
			}
			if (msg.port !== undefined && Number.isInteger(msg.port) && msg.port > 0 && msg.port < 65536) {
				await cfg.update('port', msg.port, vscode.ConfigurationTarget.Global);
			}
			this.reloadServer(cfg.get<number>('port', DEFAULT_PORT));
			await webviewView.webview.postMessage({ type: 'saved' });
		} catch (e) {
			await webviewView.webview.postMessage({
				type: 'saveError',
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = Math.random().toString(36).slice(2);
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy"
	      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		body {
			margin: 0;
			padding: 8px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-sideBar-foreground);
			background: var(--vscode-sideBar-background);
		}
		.row { margin-bottom: 12px; }
		label {
			display: block;
			margin-bottom: 3px;
			font-weight: 600;
		}
		input {
			width: 100%;
			box-sizing: border-box;
			padding: 4px 6px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 2px;
			outline: none;
		}
		input:focus { border-color: var(--vscode-focusBorder); }
		button {
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			border: none;
			padding: 4px 10px;
			cursor: pointer;
			border-radius: 2px;
			margin-right: 6px;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary {
			color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
			background: var(--vscode-button-secondaryBackground, var(--vscode-badge-background));
		}
		button.secondary:hover {
			background: var(--vscode-button-secondaryHoverBackground, var(--vscode-badge-background));
		}
		#info { margin-top: 8px; font-size: 0.9em; }
		#info.error { color: var(--vscode-errorForeground); }
	</style>
</head>
<body>
	<div class="row">
		<label for="token">API Token (OpenRouter)</label>
		<input id="token" type="password" placeholder="paste your token here" autocomplete="off">
	</div>
	<div class="row">
		<label for="model">Model</label>
		<input id="model" list="modelList" placeholder="e.g. openai/gpt-4o-mini" autocomplete="off">
		<datalist id="modelList"></datalist>
	</div>
	<div class="row">
		<label for="port">Port</label>
		<input id="port" type="number" min="1" max="65535">
	</div>
	<div class="row">
		<button id="save">Save</button>
		<button id="reload" class="secondary">Reload Server</button>
	</div>
	<div id="info"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const token = document.getElementById('token');
		const model = document.getElementById('model');
		const port = document.getElementById('port');
		const modelList = document.getElementById('modelList');
		const info = document.getElementById('info');

		function setInfo(text, isError) {
			info.textContent = text;
			info.className = isError ? 'error' : '';
		}

		vscode.postMessage({ type: 'getInitialValues' });
		vscode.postMessage({ type: 'fetchModels' });

		window.addEventListener('message', event => {
			const msg = event.data;
			switch (msg.type) {
				case 'initialValues': {
					port.value = msg.port;
					model.value = msg.model;
					token.placeholder = msg.hasToken ? '(unchanged)' : 'paste your token here';
					break;
				}
				case 'models': {
					modelList.replaceChildren(...msg.models.map(m => {
						const opt = document.createElement('option');
						opt.value = m.value;
						opt.label = m.label;
						return opt;
					}));
					break;
				}
				case 'modelsError':
					setInfo('Could not load models: ' + msg.error, true);
					break;
				case 'saved':
					token.value = '';
					token.placeholder = '(unchanged)';
					setInfo('Settings saved and server reloaded.');
					break;
				case 'saveError':
					setInfo('Save failed: ' + msg.error, true);
					break;
				case 'serverReloaded':
					setInfo('Server reloaded on port ' + port.value + '.');
					break;
			}
		});
		document.getElementById('save').onclick = () => {
			setInfo('Saving...', false);
			const raw = model.value.trim();
			const modelOut = raw && !raw.startsWith('openrouter/') ? 'openrouter/' + raw : raw;
			vscode.postMessage({
				type: 'save',
				token: token.value,
				model: modelOut,
				port: port.value === '' ? undefined : Number(port.value),
			});
		};
		document.getElementById('reload').onclick = () => {
			vscode.postMessage({ type: 'reloadServer' });
		};
	</script>
</body>
</html>`;
	}
}
