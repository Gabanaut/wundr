'use strict';
'require view';
'require rpc';

var callDiagnostic = rpc.declare({ object: 'wundr', method: 'diagnostic', params: [ 'kind', 'target', 'count' ] });

function validTarget(value) {
	return /^[A-Za-z0-9_.:-]+$/.test(String(value || '').trim());
}

return view.extend({
	render: function() {
		var kind = E('select', { 'class': 'wb-input', 'id': 'wb-diagnostic-kind', 'aria-label': _('Diagnostic type') }, [
			E('option', { 'value': 'ping' }, _('Ping')),
			E('option', { 'value': 'trace' }, _('Trace route'))
		]);
		var target = E('input', { 'class': 'wb-input', 'id': 'wb-diagnostic-target', 'type': 'text', 'placeholder': _('router.lan or an IP address'), 'autocomplete': 'off' });
		var count = E('input', { 'class': 'wb-input', 'id': 'wb-diagnostic-count', 'type': 'number', 'inputmode': 'numeric', 'min': '1', 'max': '20', 'value': '4' });
		var run = E('button', { 'class': 'wb-btn primary', 'type': 'button' }, _('Run diagnostic'));
		var status = E('div', { 'class': 'wb-sub', 'role': 'status', 'aria-live': 'polite' }, _('No diagnostic has been run.'));
		var output = E('pre', { 'class': 'wb-diagnostic-output' }, _('Results appear here after an explicit probe.'));

		function setStatus(text, kindName) {
			status.textContent = text;
			status.className = 'wb-sub' + (kindName ? ' ' + kindName : '');
		}

		run.addEventListener('click', function() {
			var host = target.value.trim();
			var samples = Number(count.value);
			if (!validTarget(host)) {
				setStatus(_('Enter a hostname or IP address using letters, numbers, dots, colons, or hyphens.'), 'wb-form-error');
				return;
			}
			if (kind.value === 'ping' && (!Number.isInteger(samples) || samples < 1 || samples > 20)) {
				setStatus(_('Ping count must be between 1 and 20.'), 'wb-form-error');
				return;
			}
			run.disabled = true;
			setStatus(_('Running an explicit ') + kind.value + _(' probe...'));
			output.textContent = _('Waiting for the router...');
			callDiagnostic(kind.value, host, kind.value === 'ping' ? samples : 0).then(function(result) {
				if (!result || result.ok === 0) {
					setStatus(result && result.error ? result.error : _('The router did not return a diagnostic result.'), 'wb-form-error');
					output.textContent = '';
					return;
				}
				var passed = result.exitCode === 0;
				setStatus(passed ? _('Probe completed successfully.') : _('Probe completed; the destination did not return success.'), passed ? 'wb-sub good' : 'wb-sub warn');
				output.textContent = result.output || _('The command returned no output.');
			}).catch(function() {
				setStatus(_('The diagnostic service could not be reached. No result is inferred.'), 'wb-form-error');
				output.textContent = '';
			}).finally(function() {
				run.disabled = false;
			});
		});

		kind.addEventListener('change', function() {
			count.disabled = kind.value !== 'ping';
		});

		return E('div', {}, [
			E('section', { 'class': 'wb-card wb-hero' }, [
				E('h2', { 'class': 'wb-h' }, _('Network Diagnostics')),
				E('div', { 'class': 'wb-sub' }, _('Explicit Ping and Trace checks for a destination you choose. These checks generate traffic only when you press Run.'))
			]),
			E('section', { 'class': 'wb-card' }, [
				E('div', { 'class': 'wb-setting-note' }, _('Targets are validated before they reach the router. Output is capped and the process is stopped after 12 seconds.')),
				E('div', { 'class': 'wb-form-row' }, [ E('label', { 'class': 'wb-form-label', 'for': 'wb-diagnostic-kind' }, _('Check')), kind ]),
				E('div', { 'class': 'wb-form-row' }, [ E('label', { 'class': 'wb-form-label', 'for': 'wb-diagnostic-target' }, _('Destination')), target ]),
				E('div', { 'class': 'wb-form-row' }, [ E('label', { 'class': 'wb-form-label', 'for': 'wb-diagnostic-count' }, _('Ping requests')), count ]),
				E('div', { 'class': 'pillrow' }, [ run, status ]),
				output
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
