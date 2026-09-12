const ENGLISH_JOURNAL_CONTENT = /* html */ `
	<p style="text-align: center"><em>Welcome to Legend in the Mist!</em></p>
	<p><strong>Legend in the Mist (RN)</strong> is an unofficial adaptation of Legend in the Mist for Foundry VTT. The project is still under active development, so some features may change. Nevertheless, the system already provides everything needed for comfortable play, including tools for the Narrator and players, tag and status management, rolls, and partial automation.</p>
	<h2>About This Project</h2>
	<ul>
		<li><p><a href="https://sonofoak.com/pages/legend-in-the-mist">Official Legend in the Mist game by Son of Oak</a></p></li>
		<li><p><a href="https://foundryvtt.com/packages/mist-engine-fvtt">Official Legend in the Mist system for Foundry VTT</a></p></li>
		<li><p><a href="https://foundryvtt.com/packages/litmv2">Legend in the Mist: Unofficial</a></p></li>
	</ul>
	<p>The (RN) version was made possible by <a href="https://foundryvtt.com/packages/litm">Legend in the Mist: Demo</a> and uses its work as a foundation. Special thanks to its creator, <strong>Filip Ambrosius (aMediocreDev)</strong>, for the outstanding work, ideas, and help they contributed to the project!</p>
	<h2>Basic Controls</h2>
	<p>Most tags and other elements have a context menu. <strong>Right-click</strong> an element to see its available actions, such as editing or deleting it. Tags and statuses can be dragged directly from their styled appearance in text. Tags can be rearranged within the Tag Manager and moved to Character sheets or their inventories, Challenge sheets, tokens on a Scene, text fields, and chat. When creating or dragging tags, hold Alt or another assigned key to create the new element as hidden.</p>
	<h2>Enrichers</h2>
	<p>Enrichers turn special text notation into a styled and, in many cases, draggable element. They work in almost every rich-text field, including journals, chat messages, and text fields on sheets. Enclose an entry from the “Notation” column in square brackets. The active result is shown on the right.</p>
	<table>
		<thead><tr><th>Element</th><th>Notation</th><th>Result</th></tr></thead>
		<tbody>
			<tr><td>Tag</td><td><code>&#64;t Keen eyes</code><br><code>&#64;tag Keen eyes</code><br><code>Keen eyes</code></td><td>[&#64;t Keen eyes]</td></tr>
			<tr><td>Weakness tag</td><td><code>&#64;tw Afraid of fire</code></td><td>[&#64;tw Afraid of fire]</td></tr>
			<tr><td>Status</td><td><code>&#64;s Wounded-2</code><br><code>&#64;status Wounded-2</code><br><code>Wounded-2</code></td><td>[&#64;s Wounded-2]</td></tr>
			<tr><td>Limit</td><td><code>&#64;l Attention:4</code><br><code>&#64;limit Attention:4</code><br><code>&#64;lx Attention</code><br><code>&#64;ln Attention</code><br><code>-Attention:4</code></td><td>[&#64;l Attention:4] [&#64;lx Attention] [&#64;ln Attention]</td></tr>
			<tr><td>Might with a scale</td><td><code>&#64;m Ancient magic-5</code></td><td>[&#64;m Ancient magic-5]</td></tr>
			<tr><td>Might by category</td><td><code>&#64;o Origin</code><br><code>&#64;a Adventure</code><br><code>&#64;g Greatness</code></td><td>[&#64;o Origin] [&#64;a Adventure] [&#64;g Greatness]</td></tr>
			<tr><td>Special</td><td><code>&#64;sp Name: Description</code><br><code>&#64;special Name: Description</code></td><td>[&#64;sp Name: Description]</td></tr>
		</tbody>
	</table>
	<p>Short and long forms are equivalent, but the simplified tag notation that uses only square brackets without special symbols is not recommended. This notation may be removed in a future version.</p>
	<h2>Keyboard Shortcuts</h2>
	<p>All keyboard shortcuts can be reassigned in Foundry VTT's Configure Controls settings.</p>
	<table>
		<thead><tr><th>Key</th><th>Action</th></tr></thead>
		<tbody>
			<tr><td><strong>I</strong></td><td>Open / close the Rules Reference.</td></tr>
			<tr><td><strong>R</strong></td><td>Open / close the Roll Dialog.</td></tr>
			<tr><td><strong>T</strong></td><td>Open / close the Tag Manager.</td></tr>
			<tr><td><strong>Alt</strong></td><td><em>(hold while creating or dragging)</em><br>Create newly added Tags, Statuses, Might, and Limits as hidden.</td></tr>
		</tbody>
	</table>
	<h2>System Tours</h2>
	<p>The tours can be started again from Foundry VTT's Tour Management screen. They introduce the Hero sheet, Fellowship, Tag Manager, general tips, and system settings.</p>
	<p>Have a great game, and may your stories in the mist be unforgettable!</p>
`;

const RUSSIAN_JOURNAL_CONTENT = /* html */ `
	<p style="text-align: center"><em>Добро пожаловать в Legend in the Mist!</em></p>
	<p><strong>Legend in the Mist (RN)</strong> — неофициальная адаптация Legend in the Mist для Foundry VTT. Проект всё ещё активно развивается, поэтому отдельные элементы могут меняться. При этом в системе уже есть всё необходимое для комфортной игры: инструменты для рассказчика и игроков, управление тегами и статусами, броски и частичная автоматизация.</p>
	<h2>О проекте</h2>
	<ul>
		<li><p><a href="https://sonofoak.com/pages/legend-in-the-mist">Официальная страница Legend in the Mist от Son of Oak</a></p></li>
		<li><p><a href="https://foundryvtt.com/packages/mist-engine-fvtt">Официальная система Legend in the Mist для Foundry VTT</a></p></li>
		<li><p><a href="https://foundryvtt.com/packages/litmv2">Legend in the Mist: Unofficial</a></p></li>
	</ul>
	<p>Версия (RN) появилась благодаря <a href="https://foundryvtt.com/packages/litm">Legend in the Mist: Demo</a> и взяла её наработки за основу. Особая благодарность её автору — <strong>Filip Ambrosius (aMediocreDev)</strong>, за потрясающую работу, идеи и помощь с проектом!</p>
	<h2>Основы управления</h2>
	<p>Большая часть тегов и других элементов имеет контекстное меню. Кликните по элементу <strong>правой кнопкой мыши</strong>, чтобы увидеть доступные действия — например, редактирование или удаление. Теги и статусы можно перетаскивать непосредственно из их оформленного представления в тексте. Теги можно перетаскивать между собой в менеджере тегов, перемещать их в листы персонажей или в их инвентарь, в листы испытаний, на токены в сцене, в текстовые поля и чат. При создании или перетаскивании тегов удерживайте Alt или другую назначенную клавишу, чтобы сразу сделать новый элемент скрытым.</p>
	<h2>Энричеры</h2>
	<p>Энричеры превращают специальную текстовую запись в оформленный и, во многих случаях, перетаскиваемый элемент. Они работают почти во всех форматируемых текстовых полях, включая журналы, сообщения чата и текстовые поля листов. Записи из соответствующей колонки заключаются в квадратные скобки. Справа показан действующий результат.</p>
	<table>
		<thead><tr><th>Элемент</th><th>Запись</th><th>Результат</th></tr></thead>
		<tbody>
			<tr><td>Тег</td><td><code>&#64;t Keen eyes</code><br><code>&#64;tag Keen eyes</code><br><code>Keen eyes</code></td><td>[&#64;t Keen eyes]</td></tr>
			<tr><td>Тег слабости</td><td><code>&#64;tw Afraid of fire</code></td><td>[&#64;tw Afraid of fire]</td></tr>
			<tr><td>Статус</td><td><code>&#64;s Wounded-2</code><br><code>&#64;status Wounded-2</code><br><code>Wounded-2</code></td><td>[&#64;s Wounded-2]</td></tr>
			<tr><td>Лимит</td><td><code>&#64;l Attention:4</code><br><code>&#64;limit Attention:4</code><br><code>&#64;lx Attention</code><br><code>&#64;ln Attention</code><br><code>-Attention:4</code></td><td>[&#64;l Attention:4] [&#64;lx Attention] [&#64;ln Attention]</td></tr>
			<tr><td>Могущество (масштабируемое)</td><td><code>&#64;m Ancient magic-5</code></td><td>[&#64;m Ancient magic-5]</td></tr>
			<tr><td>Могущество (по категории)</td><td><code>&#64;o Origin</code><br><code>&#64;a Adventure</code><br><code>&#64;g Greatness</code></td><td>[&#64;o Origin] [&#64;a Adventure] [&#64;g Greatness]</td></tr>
			<tr><td>Особенность</td><td><code>&#64;sp Name: Description</code><br><code>&#64;special Name: Description</code></td><td>[&#64;sp Name: Description]</td></tr>
		</tbody>
	</table>
	<p>Короткие и длинные формы равнозначны, но рекомендуется не использовать упрощённый формат записи тегов только с квадратными скобками без специальных символов — в следующих версиях этот формат записи может быть удалён.</p>
	<h2>Горячие клавиши</h2>
	<p>Все горячие клавиши можно переназначить в настройках управления Foundry VTT.</p>
	<table>
		<thead><tr><th>Клавиша</th><th>Действие</th></tr></thead>
		<tbody>
			<tr><td><strong>I</strong></td><td>Открыть / закрыть Памятку правил.</td></tr>
			<tr><td><strong>R</strong></td><td>Открыть / закрыть Окно броска.</td></tr>
			<tr><td><strong>T</strong></td><td>Открыть / закрыть Менеджер тегов.</td></tr>
			<tr><td><strong>Alt</strong></td><td><em>(удерживать при создании или перетаскивании)</em><br>Создавать добавляемые Теги, Статусы, Могущество и Лимиты скрытыми.</td></tr>
		</tbody>
	</table>
	<h2>Экскурсы по системе</h2>
	<p>Экскурсы можно запустить повторно через раздел управления экскурсами Foundry VTT. Они знакомят с листом персонажа, Содружеством, Менеджером тегов, общими подсказками и настройками системы.</p>
	<p>Хорошей игры и незабываемых историй в тумане!…</p>
`;

/**
 * Return the first-world journal content for the active Foundry language.
 * Russian has a dedicated version; every other language falls back to English.
 * @param {string} language Active Foundry language code.
 * @returns {{pageName: string, journalContent: string}}
 */
export function getWelcomeJournalContent(language) {
	if (language?.toLowerCase().startsWith("ru")) {
		return {
			pageName: "Основы системы",
			journalContent: RUSSIAN_JOURNAL_CONTENT,
		};
	}
	return { pageName: "System Basics", journalContent: ENGLISH_JOURNAL_CONTENT };
}

/**
 * Build the first-world chat message with a direct link to its journal.
 * @param {string} language Active Foundry language code.
 * @param {string} journalUuid UUID of the newly created journal.
 * @param {string} journalId ID of the newly created journal.
 * @returns {string}
 */
export function getWelcomeChatContent(language, journalUuid, journalId) {
	const journalLink = `<a class="content-link" draggable="true" data-link data-uuid="${journalUuid}" data-id="${journalId}" data-type="JournalEntry"><i class="fas fa-book-open"></i><strong>Legend in the Mist</strong></a>`;
	if (language?.toLowerCase().startsWith("ru")) {
		return /* html */ `
			<p><strong>Добро пожаловать в Legend in the Mist!</strong></p>
			<p>Перед первой игрой рекомендуется прочитать журнал ${journalLink}. В нём собрана общая информация о системе и элементах управления.</p>
			<p>После этого пройдите экскурсы по системе — они познакомят вас с листом персонажа и некоторыми полезными возможностями.</p>
			<p><em><strong>Хорошей игры и незабываемых историй в тумане!…</strong></em></p>
		`;
	}
	return /* html */ `
		<p><strong>Welcome to Legend in the Mist!</strong></p>
		<p>Before your first game, we recommend reading the ${journalLink} journal. It contains general information about the system and its controls.</p>
		<p>After that, take the system tours — they will introduce you to the Character sheet and several useful features.</p>
		<p><em><strong>Have a great game, and may your stories in the mist be unforgettable!…</strong></em></p>
	`;
}
