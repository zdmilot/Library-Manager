/**
 * Automated script to replace all native alert(), confirm(), and prompt() calls
 * in html/js/main.js with styled modal equivalents.
 * 
 * Run: node tools/replace-dialogs.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'html', 'js', 'main.js');
let src = fs.readFileSync(FILE, 'utf8');
let lines = src.split('\n');
let changeCount = 0;

/**
 * Categorize an alert message to determine icon and title.
 */
function categorizeAlert(msgExpr, lineContent) {
	const lc = lineContent.toLowerCase();
	const mc = msgExpr.toLowerCase();
	
	// Success patterns
	if (mc.includes('successfully') || mc.includes('successful') || mc.includes('exported to:')) {
		return { title: 'Success', iconClass: 'fa-check-circle', iconStyle: 'app-alert-icon-success' };
	}
	// Error patterns
	if (mc.includes('error') || mc.includes('failed') || mc.includes('could not') || mc.includes('cannot') ||
		mc.includes('not found') || mc.includes('corrupt') || mc.includes('invalid') || mc.includes('missing') ||
		mc.includes('aborted')) {
		return { title: 'Error', iconClass: 'fa-exclamation-circle', iconStyle: 'app-alert-icon-error' };
	}
	// Warning patterns - things that aren't errors but cautions
	if (mc.includes('read-only') || mc.includes('protected') || mc.includes('too large') ||
		mc.includes('already installed') || mc.includes('already in progress') || mc.includes('note:') ||
		mc.includes('skipped') || mc.includes('no com dlls') || mc.includes('no libraries could')) {
		return { title: 'Warning', iconClass: 'fa-exclamation-triangle', iconStyle: 'app-alert-icon-warning' };
	}
	// Validation patterns
	if (mc.includes('required') || mc.includes('please') || mc.includes('only') || mc.includes('must be')) {
		return { title: 'Validation', iconClass: 'fa-exclamation-circle', iconStyle: 'app-alert-icon-error' };
	}
	// Info patterns
	if (mc.includes('com dll') || mc.includes('registration')) {
		return { title: 'Information', iconClass: 'fa-info-circle', iconStyle: '' };
	}
	// Default to info
	return { title: 'Notice', iconClass: 'fa-info-circle', iconStyle: '' };
}

/**
 * Build the showAppAlert call string from categorization
 */
function buildAlertCall(msgExpr, lineContent) {
	const cat = categorizeAlert(msgExpr, lineContent);
	const optsStr = `{ iconClass: '${cat.iconClass}'${cat.iconStyle ? ", iconStyle: '" + cat.iconStyle + "'" : ''} }`;
	return `showAppAlert('${cat.title}', ${msgExpr}, ${optsStr})`;
}

// Track replacements for logging
const replacements = [];

for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	const lineNum = i + 1;
	
	// Skip lines that already use showAppAlert, showGenericSuccessModal, showTagValidation, or are comments
	if (line.includes('showAppAlert') || line.includes('showGenericSuccess') || 
		line.includes('showTagValidation') || line.includes('showAppConfirm') ||
		line.includes('showAppPrompt')) continue;
	
	// Skip the function definition of showAppAlert/showAppPrompt
	if (line.includes('function showApp')) continue;
	
	// ========== ALERT REPLACEMENTS ==========
	
	// Pattern 1: if (!silent) alert(msg);
	const silentAlertMatch = line.match(/^(\s*)if\s*\(!silent\)\s*alert\((.+?)\);(.*)$/);
	if (silentAlertMatch) {
		const indent = silentAlertMatch[1];
		const msgExpr = silentAlertMatch[2];
		const trailing = silentAlertMatch[3];
		const replacement = buildAlertCall(msgExpr, line);
		lines[i] = `${indent}if (!silent) ${replacement};${trailing}`;
		replacements.push({ line: lineNum, type: 'alert-silent', msg: msgExpr.substring(0, 50) });
		changeCount++;
		continue;
	}
	
	// Pattern 2: standalone alert('...');
	// Must be careful not to match lines inside strings or comments
	const standaloneMatch = line.match(/^(\s*)alert\((.+)\);(.*)$/);
	if (standaloneMatch) {
		const indent = standaloneMatch[1];
		const msgExpr = standaloneMatch[2];
		const trailing = standaloneMatch[3];
		const replacement = buildAlertCall(msgExpr, line);
		lines[i] = `${indent}${replacement};${trailing}`;
		replacements.push({ line: lineNum, type: 'alert-standalone', msg: msgExpr.substring(0, 50) });
		changeCount++;
		continue;
	}
	
	// Pattern 3: { alert("..."); return; }  (inline on single line)
	const inlineAlertReturnMatch = line.match(/^(\s*)(if\s*\([^)]+\)\s*\{\s*)alert\((.+?)\);\s*(return[^}]*;)\s*(\}.*)$/);
	if (inlineAlertReturnMatch) {
		const indent = inlineAlertReturnMatch[1];
		const ifPart = inlineAlertReturnMatch[2];
		const msgExpr = inlineAlertReturnMatch[3];
		const returnPart = inlineAlertReturnMatch[4];
		const closePart = inlineAlertReturnMatch[5];
		const replacement = buildAlertCall(msgExpr, line);
		lines[i] = `${indent}${ifPart}${replacement}; ${returnPart} ${closePart}`;
		replacements.push({ line: lineNum, type: 'alert-inline-return', msg: msgExpr.substring(0, 50) });
		changeCount++;
		continue;
	}
}

const newSrc = lines.join('\n');
fs.writeFileSync(FILE, newSrc, 'utf8');

console.log(`\n=== Dialog Replacement Summary ===`);
console.log(`Total replacements: ${changeCount}`);
console.log(`\nDetailed log:`);
replacements.forEach(r => {
	console.log(`  Line ${r.line}: [${r.type}] ${r.msg}...`);
});

// Now verify no plain alert() calls remain (except in comments/strings)
const remaining = [];
const finalLines = newSrc.split('\n');
for (let i = 0; i < finalLines.length; i++) {
	const line = finalLines[i];
	if (line.includes('showAppAlert') || line.includes('showGenericSuccess') || 
		line.includes('showTagValidation') || line.includes('showAppConfirm') ||
		line.includes('showAppPrompt') || line.includes('function showApp')) continue;
	// Check for remaining alert( calls
	if (/\balert\s*\(/.test(line)) {
		remaining.push({ line: i + 1, content: line.trim().substring(0, 100) });
	}
}
if (remaining.length > 0) {
	console.log(`\n⚠️  ${remaining.length} alert() calls could not be auto-replaced:`);
	remaining.forEach(r => {
		console.log(`  Line ${r.line}: ${r.content}`);
	});
} else {
	console.log(`\n✅ All alert() calls have been replaced!`);
}
