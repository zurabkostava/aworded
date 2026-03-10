//script.js
// ==== 1. გლობალური მდგომარეობის ცვლადები ====
let currentUser = null;
let isAppInitialized = false; // NEW: ჩვენი "ალამი"
let isEditing = false;
let editingCard = null;
let mainTranslations = [];
let extraTranslations = [];
let tags = [];
let allTags = new Set();
let selectionMode = false;
let longPressTimer = null;
let wasLongPress = false;
let activeFilterTags = new Set();
let currentCardIndex = -1;
let currentSortMode = 'progress';
let isPlaying = false;
let stopRequested = false;
let shuffleMode = false;
let playedIndices = [];
let previewManuallyClosed = false;
let sortOrder = 'asc';
let touchStartX = 0;
let touchEndX = 0;
let isPlayerMinimized = false; // <-- NEW: ჩაკეცვის მდგომარეობა
const STORAGE_KEY = 'english_cards_app';
const TEXTAREA_STORAGE_KEY = 'sentence_textareas_data';
const SORT_MODE_KEY = 'aworded_sort_mode'; // NEW
const DICTIONARY_KEY = 'aworded_current_dictionary';
let currentDictionaryId = null;
let allDictionaries = [];
// ==== 2. ყველა ფუნქციის დეფინიცია (გლობალური) ====
function updateStatsModal() {
    const allCards = document.querySelectorAll('.card');
    const totalWords = allCards.length;
    let masteredCount = 0;
    let totalProgress = 0;
    allCards.forEach(card => {
        const prog = parseFloat(card.dataset.progress || '0');
        if (prog >= 100) {
            masteredCount++;
        }
        totalProgress += prog;
    });
    const avgProgress = totalWords > 0 ? (totalProgress / totalWords).toFixed(1) : 0;
    const totalTests = parseInt(localStorage.getItem('TOTAL_TESTS') || '0');
    const totalCorrect = parseInt(localStorage.getItem('TOTAL_CORRECT') || '0');
    const totalWrong = parseInt(localStorage.getItem('TOTAL_WRONG') || '0');
    const totalAnswers = totalCorrect + totalWrong;
    let correctPercent = 0, wrongPercent = 0;
    if (totalAnswers > 0) {
        correctPercent = ((totalCorrect / totalAnswers) * 100).toFixed(1);
        wrongPercent = ((totalWrong / totalAnswers) * 100).toFixed(1);
    }
    document.getElementById('statsTotalWords').textContent = totalWords;
    document.getElementById('statsMastered').textContent = masteredCount;
    document.getElementById('statsTotal2').textContent = totalWords;
    document.getElementById('statsAvgProgress').textContent = avgProgress;
    document.getElementById('statsTests').textContent = totalTests;
    document.getElementById('statsCorrectWrong').textContent = `${totalCorrect} - ${totalWrong} (${correctPercent}% - ${wrongPercent}%)`;
}
function getGlobalTrainingSettings() {
    const tag = document.getElementById('globalTagSelect')?.value || '';
    const count = parseInt(document.getElementById('globalQuestionCount')?.value || '10');
    const reverse = document.getElementById('globalReverseToggle')?.checked || false;
    const hideMastered = document.getElementById('globalHideMastered')?.checked || false;
    return {tag, count, reverse, hideMastered};
}
function populateGlobalTags() {
    const select = document.getElementById('globalTagSelect');
    if (!select) return;
    const tagSet = new Set();
    document.querySelectorAll('.card').forEach(card => {
        card.querySelectorAll('.card-tag').forEach(tagEl => {
            const tag = tagEl.textContent.replace('#', '').trim();
            if (tag) tagSet.add(tag);
        });
    });
    select.innerHTML = '<option value="">ყველა</option>';
    [...tagSet].sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        select.appendChild(opt);
    });
}
function getVisibleCards() {
    const hideMastered = document.getElementById('globalHideMastered')?.checked;
    return [...document.querySelectorAll('.card')].filter(c => {
        const visible = c.style.display !== 'none';
        const mastered = parseFloat(c.dataset.progress || '0') >= 100;
        return visible && (!hideMastered || !mastered);
    });
}
async function speakPreviewCard(card) {
    if (!card) return;
    const word = card.querySelector('.word').textContent;
    const translationEl = card.querySelector('.translation');
    const mainPart = translationEl.childNodes[0]?.textContent?.trim() || '';
    const extraPart = translationEl.querySelector('.extra')?.textContent?.trim() || '';
    const en = JSON.parse(card.dataset.english || '[]');
    const ge = JSON.parse(card.dataset.georgian || '[]');
    await delay(500);
    const previewWordEl = document.getElementById('previewWord');
    await speakWithVoice(word, selectedVoice, null, null, previewWordEl, true);
// ⬆️ აქედან ამოვიღეთ updateCardProgress ⬆️
    const previewTranslationEl = document.getElementById('previewTranslation');
    await speakWithVoice(mainPart, selectedGeorgianVoice, null, extraPart, previewTranslationEl, true);
    for (let i = 0; i < Math.max(en.length, ge.length); i++) {
        if (en[i]) {
            const enEl = document.querySelectorAll('#previewEnglishSentences p')[i];
            await speakWithVoice(en[i], selectedVoice, null, null, enEl, true);
        }
        if (ge[i]) {
            const geEl = document.querySelectorAll('#previewGeorgianSentences p')[i];
            await speakWithVoice(ge[i], selectedGeorgianVoice, null, null, geEl, true);
        }
    }
}
function saveTextareaToLocalStorage() {
    const data = {
        english: document.getElementById('englishSentences').value,
        georgian: document.getElementById('georgianSentences').value
    };
    localStorage.setItem(TEXTAREA_STORAGE_KEY, JSON.stringify(data));
}
function setupSmartNumbering(textarea) {
    textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const currentLines = textarea.value.split('\n');
            const nextNumber = currentLines.length + 1;
            const before = textarea.value.substring(0, textarea.selectionStart);
            const after = textarea.value.substring(textarea.selectionStart);
            const prefix = `${nextNumber}. `;
            textarea.value = before + '\n' + prefix + after;
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = before.length + prefix.length + 1;
            }, 0);
        }
    });
    textarea.addEventListener('focus', () => {
        const lines = textarea.value.split('\n');
        if (lines.length > 0 && !/^\d+\.\s/.test(lines[0])) {
            lines[0] = '1. ' + lines[0].replace(/^\d+\.\s*/, '');
            textarea.value = lines.join('\n');
        }
    });
}
function handleSwipeGesture() {
    const threshold = 50;
    if (touchEndX - touchStartX > threshold) {
        document.getElementById('prevCardBtn').click();
    } else if (touchStartX - touchEndX > threshold) {
        document.getElementById('nextCardBtn').click();
    }
}
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}
function sortCards() {
    const cardContainer = document.getElementById('cardContainer');
    const cards = [...document.querySelectorAll('.card')];
    cards.sort((a, b) => {
        let valA, valB;
        if (currentSortMode === 'alphabetical') {
            valA = a.querySelector('.word').textContent.trim().toLowerCase();
            valB = b.querySelector('.word').textContent.trim().toLowerCase();
        } else if (currentSortMode === 'updated') {
            valA = parseInt(a.dataset.updated || 0);
            valB = parseInt(b.dataset.updated || 0);
        } else if (currentSortMode === 'progress') {
            valA = parseFloat(a.dataset.progress || 0);
            valB = parseFloat(b.dataset.progress || 0);
        }
        const result = valA > valB ? 1 : valA < valB ? -1 : 0;
        return sortOrder === 'asc' ? result : -result;
    });
    cards.forEach(card => cardContainer.appendChild(card));
}
function applyCurrentSort() {
// NEW CHECK:
// თუ ფლეიერი მუშაობს (isPlaying) და shuffle გამორთულია,
// და ამჟამინდელი სორტირება "პროგრესია" -> არ გადაალაგო.
    if (isPlaying && !shuffleMode && currentSortMode === 'progress') {
        return; // გამოტოვე სორტირება
    }
    sortCards(); // გადაალაგე ქარდები
}
// ==== NEW HELPER FUNCTION ====
/**
 * ანახლებს ჩაკეცილი ფლეერის ტექსტს
 */
function updateMinimizedDisplay(card) {
    const display = document.getElementById('playerMinimizedDisplay');
    if (!display || !card) {
        if (display) display.style.display = 'none';
        return;
    }
    const word = card.querySelector('.word').textContent.trim();
    const mainPart = card.querySelector('.translation').childNodes[0]?.textContent?.trim() || '';
    display.innerHTML = `<span><strong>${word}</strong> - ${mainPart}</span>`;
    // ვაჩენთ მხოლოდ იმ შემთხვევაში, თუ ჩაკეცილია
    if (isPlayerMinimized) {
        display.style.display = 'block';
    }
}
async function startAutoPlay() {
    const cards = getVisibleCards();
    if (cards.length === 0) return;
    isPlaying = true;
    document.querySelector('.player .fa-play').closest('button').classList.add('active');
    stopRequested = false;
    while (!stopRequested) {
        if (shuffleMode) {
            if (playedIndices.length >= cards.length) {
                playedIndices = [];
            }
            let nextIndex;
            do {
                nextIndex = Math.floor(Math.random() * cards.length);
            } while (playedIndices.includes(nextIndex));
            currentCardIndex = nextIndex;
            playedIndices.push(currentCardIndex);
        } else {
            if (currentCardIndex === -1 || currentCardIndex >= cards.length) {
                currentCardIndex = 0;
            }
        }
        if (!cards[currentCardIndex]) {
            currentCardIndex = 0;
            if (cards.length === 0) break;
        }
        const card = cards[currentCardIndex];
        document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
        card.classList.add('playing');
        // --- PLAYER LOGIC UPDATED ---
        updateMinimizedDisplay(card); // 1. განვაახლოთ ჩაკეცილი ტექსტი
        // 2. ვაჩვენოთ მოდალი მხოლოდ იმ შემთხვევაში, თუ არ არის ჩაკეცილი
        if (!previewManuallyClosed && !isPlayerMinimized) {
            loadCardIntoModal(card);
        }
        // --- END UPDATE ---
        await delay(300);
        if (stopRequested) break;
        await speakPreviewCard(card);
        await delay(500);
        if (stopRequested) break;
        if (!shuffleMode) currentCardIndex++;
    }
    isPlaying = false;
    document.querySelector('.player .fa-play').closest('button').classList.remove('active');
    // --- PLAYER LOGIC UPDATED ---
    isPlayerMinimized = false; // 3. დაკვრის დასრულებისას, გავასუფთავოთ
    updateMinimizedDisplay(null); // 4. დავმალოთ ჩაკეცილი ბლოკი
    // --- END UPDATE ---
// როცა დაკვრა ბუნებრივად სრულდება, აქაც განვაახლოთ სორტირება
    if (currentSortMode === 'progress') {
        sortCards();
    }
}
function addTranslation(inputEl, list, container) {
    const val = inputEl.value.trim();
    if (val && !list.includes(val)) {
        list.push(val);
        renderTags(container, list, list, true);
        inputEl.value = '';
    }
}
function showTagDropdown(filterValue) {
    const tagDropdown = document.getElementById('tagDropdown');
    const matches = [...allTags].filter(tagObj =>
        tagObj.name.toLowerCase().includes(filterValue)
    );
    tagDropdown.innerHTML = '';
    tagDropdown.style.display = matches.length ? 'block' : 'none';
    matches.forEach(tagObj => {
        const tagName = tagObj.name;
        const div = document.createElement('div');
        div.textContent = tagName;
// `tags` (გლობალური) არის სტრინგების მასივი, რომელიც მოდალში ივსება
        if (tags.includes(tagName)) {
            div.style.opacity = '0.5';
            div.style.pointerEvents = 'none';
            div.style.fontStyle = 'italic';
            div.textContent += ' ✓';
        } else {
            div.onclick = () => {
                tags.push(tagName); // `tags` მასივს ვამატებთ სახელს
                renderTags(document.getElementById('tagList'), tags, tags, false);
                document.getElementById('tagInput').value = '';
                tagDropdown.style.display = 'none';
            };
        }
        tagDropdown.appendChild(div);
    });
}
function renderSidebarTags() {
    const sidebarTagList = document.getElementById('sidebarTagList');
    sidebarTagList.innerHTML = '';
    const cards = [...document.querySelectorAll('.card')];
    const tagCounts = {};
    cards.forEach(card => {
        card.querySelectorAll('.card-tag').forEach(span => {
            const tag = span.textContent.replace('#', '').trim();
            if (!tag) return;
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });
    const addContainer = document.createElement('li');
    addContainer.className = 'tag-add-container';
    const input = document.createElement('input');
    input.placeholder = 'ახალი თეგი';
    input.style.flex = '1';
    const addBtn = document.createElement('button');
    addBtn.innerHTML = '<i class="fas fa-plus"></i>';
    addBtn.onclick = async () => {
        const val = input.value.trim();
        if (!val) return;
// შევამოწმოთ, ხომ არ არსებობს უკვე (სახელით)
        const exists = [...allTags].some(tag => tag.name.toLowerCase() === val.toLowerCase());
        if (exists) {
            showToast("ასეთი თეგი უკვე არსებობს", "error");
            return;
        }
// 1. შევინახოთ ბაზაში
        const {data, error} = await supabaseClient
            .from('tags')
            .insert({user_id: currentUser.id, name: val})
            .select()
            .single(); // დაგვიბრუნე შექმნილი ობიექტი
        if (error) {
            showToast(`თეგის დამატება ვერ მოხერხდა: ${error.message}`, "error");
        } else {
// 2. დავამატოთ გლობალურ სიაში
            allTags.add(data); // data არის {id, name, ...}
// 3. განვაახლოთ საიდბარი
            renderSidebarTags();
            showToast("თეგი დაემატა", "success");
        }
        input.value = '';
    };
    addContainer.appendChild(input);
    addContainer.appendChild(addBtn);
    sidebarTagList.appendChild(addContainer);
// თეგების სია
    [...allTags].sort((a, b) => a.name.localeCompare(b.name)).forEach(tagObject => {
        const tagName = tagObject.name; // <-- ვიღებთ სახელს
        const li = document.createElement('li');
        li.className = 'sidebar-tag-item';
        const count = tagCounts[tagName] || 0; // <-- ვითვლით სახელით
        const isActive = activeFilterTags.has(tagName); // <-- ვამოწმებთ სახელით
        if (isActive) li.classList.add('active');
        const tagLabel = document.createElement('span');
        tagLabel.textContent = tagName; // <-- ვაჩვენებთ სახელს
        tagLabel.style.flex = '1';
        tagLabel.style.cursor = 'pointer';
        const countBadge = document.createElement('span');
        countBadge.textContent = count;
        countBadge.className = 'tag-count-badge';
        li.onclick = (e) => {
            if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
            if (activeFilterTags.has(tagName)) {
                activeFilterTags.delete(tagName);
            } else {
                activeFilterTags.add(tagName);
            }
            renderSidebarTags();
            filterCardsByTags();
        };
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            const editInput = document.createElement('input');
            editInput.value = tagName; // ვიყენებთ tagName-ს
            editInput.style.flex = '1';
            const saveBtn = document.createElement('button');
            saveBtn.innerHTML = '<i class="fas fa-save"></i>';
            saveBtn.onclick = async () => {
                const newVal = editInput.value.trim();
                const oldVal = tagObject.name; // ვიმახსოვრებთ ძველ სახელს
// ვამოწმებთ, ხომ არ არსებობს
                const exists = [...allTags].some(t => t.name.toLowerCase() === newVal.toLowerCase() && t.id !== tagObject.id);
                if (!newVal || newVal === oldVal || exists) {
                    renderSidebarTags(); // უბრალოდ დავხუროთ რედაქტირება
                    return;
                }
// 1. განვაახლოთ ბაზაში
                const {data, error} = await supabaseClient
                    .from('tags')
                    .update({name: newVal})
                    .eq('id', tagObject.id)
                    .select()
                    .single();
                if (error) {
                    showToast(`განახლება ვერ მოხერხდა: ${error.message}`, 'error');
                    return;
                }
// 2. განვაახლოთ გლობალური 'allTags'
                tagObject.name = newVal; // (ვცვლით ობიექტს პირდაპირ Set-ში)
// 3. განვაახლოთ ყველა ბარათის UI, რომელიც ამ თეგს იყენებს
                document.querySelectorAll('.card').forEach(card => {
                    card.querySelectorAll('.card-tag').forEach(span => {
                        if (span.textContent === `#${oldVal}`) {
                            span.textContent = `#${newVal}`;
                            span.style.backgroundColor = getColorForTag(newVal);
                        }
                    });
// განვაახლოთ dataset-იც
                    let tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
                    let tagToUpdate = tagObjects.find(t => t.id === tagObject.id);
                    if (tagToUpdate) {
                        tagToUpdate.name = newVal;
                    }
                    card.dataset.tagObjects = JSON.stringify(tagObjects);
                });
// 4. განვაახლოთ აქტიური ფილტრები
                if (activeFilterTags.has(oldVal)) {
                    activeFilterTags.delete(oldVal);
                    activeFilterTags.add(newVal);
                }
                renderSidebarTags();
                filterCardsByTags();
                showToast("თეგი განახლდა", "success");
            };
            const cancelBtn = document.createElement('button');
            cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
            cancelBtn.onclick = () => renderSidebarTags();
            li.innerHTML = '';
            li.appendChild(editInput);
            li.appendChild(saveBtn);
            li.appendChild(cancelBtn);
        };
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm(`ნამდვილად გსურთ თეგის "${tagName}" წაშლა?`)) return;
// 1. წაშლა ბაზიდან ('card_tags'-დან კავშირები ავტომატურად წაიშლება)
            const {error} = await supabaseClient
                .from('tags')
                .delete()
                .eq('id', tagObject.id);
            if (error) {
                showToast(`წაშლა ვერ მოხერხდა: ${error.message}`, 'error');
                return;
            }
// 2. წაშლა გლობალური 'allTags' სიიდან
            allTags.delete(tagObject);
// 3. წაშლა UI-დან (ყველა ბარათიდან)
            document.querySelectorAll('.card').forEach(card => {
                card.querySelectorAll('.card-tag').forEach(span => {
                    if (span.textContent === `#${tagName}`) span.remove();
                });
// წაშლა dataset-იდან
                let tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
                let updatedObjects = tagObjects.filter(t => t.id !== tagObject.id);
                card.dataset.tagObjects = JSON.stringify(updatedObjects);
            });
// 4. წაშლა აქტიური ფილტრებიდან
            activeFilterTags.delete(tagName);
            renderSidebarTags();
            filterCardsByTags();
            showToast("თეგი წაიშალა", "success");
        };
        const tagWrapper = document.createElement('div');
        tagWrapper.style.display = 'flex';
        tagWrapper.style.alignItems = 'center';
        tagWrapper.style.gap = '6px';
        tagWrapper.style.flex = '1';
        tagWrapper.appendChild(tagLabel);
        tagWrapper.appendChild(countBadge);
        li.appendChild(tagWrapper);
        li.appendChild(editBtn);
        li.appendChild(deleteBtn);
        sidebarTagList.appendChild(li);
    });
}
function filterCardsByTags() {
    const tagsArray = [...activeFilterTags];
// NEW: წავიკითხოთ ჩამრთველის მდგომარეობაც
    const hideMastered = document.getElementById('hideMasteredCheckbox').checked;
    document.querySelectorAll('.card').forEach(card => {
        const tagSpans = [...card.querySelectorAll('.tags span')];
        const cardTags = tagSpans.map(span => span.textContent.replace('#', ''));
// 1. ვამოწმებთ, ემთხვევა თუ არა თეგებს
        const matchesTags = tagsArray.some(tag => cardTags.includes(tag)) || tagsArray.length === 0;
// 2. ვამოწმებთ, ხომ არ არის "ნასწავლი" და ხომ არ ვმალავთ მას
        const isMastered = parseFloat(card.dataset.progress || 0) >= 100;
        const matchesMastered = !hideMastered || !isMastered; // (უნდა გამოჩნდეს, თუ "დამალვა" გამორთულია, ან თუ დამასტერებული არაა)
// 3. ბარათი ჩანს მხოლოდ იმ შემთხვევაში, თუ ორივე პირობას აკმაყოფილებს
        card.style.display = (matchesTags && matchesMastered) ? 'block' : 'none';
// განვაახლოთ გაფილტრული თეგების სტილი
        tagSpans.forEach(span => {
            const tag = span.textContent.replace('#', '');
            if (tagsArray.includes(tag)) {
                span.classList.add('filtered');
            } else {
                span.classList.remove('filtered');
            }
        });
    });
}
function editCard(card) {
    const word = card.querySelector('.word').textContent;
    const translationEl = card.querySelector('.translation');
    const mainPart = translationEl.childNodes[0]?.textContent?.trim();
    const extraPart = translationEl.querySelector('.extra')?.textContent?.trim();
    mainTranslations = mainPart ? mainPart.split(',').map(s => s.trim()) : [];
    extraTranslations = extraPart ? extraPart.split(',').map(s => s.trim()) : [];
// NEW: ვკითხულობთ თეგის ობიექტებს, რომლებიც dataset-ში შევინახეთ
    const tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
// `tags` (გლობალური ცვლადი) ინახავს *სახელებს* მოდალისთვის
    tags = tagObjects.map(tagObj => tagObj.name);
    const en = JSON.parse(card.dataset.english || '[]');
    const ge = JSON.parse(card.dataset.georgian || '[]');
    document.getElementById('englishSentences').value = en.map((s, i) => `${i + 1}. ${s}`).join('\n');
    document.getElementById('georgianSentences').value = ge.map((s, i) => `${i + 1}. ${s}`).join('\n');
    document.getElementById('wordInput').value = word;
    renderTags(document.getElementById('mainTranslationTags'), mainTranslations, mainTranslations, true);
    renderTags(document.getElementById('extraTranslationTags'), extraTranslations, extraTranslations, true);
    renderTags(document.getElementById('tagList'), tags, tags, false); // ეს სწორად მუშაობს, მას სახელები უნდა
    isEditing = true;
    editingCard = card; // editingCard-ში ინახება ბარათი თავისი dataset.id-ით
    document.getElementById('modalOverlay').style.display = 'flex';
}
function getColorForTag(tag) {
    const hash = Array.from(tag).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hash % 360;
    return `hsl(${hue}, 80%, 95%)`;
}
function renderCardFromData(data) {
// 1. მონაცემების გარდაქმნა
    const cardData = {
        id: data.id,
        word: data.word,
        mainTranslations: data.main_translations || [],
        extraTranslations: data.extra_translations || [],
// NEW: data.tags არის [{id, name}], ჩვენ გვჭირდება [name]
        tags: (data.tags || []).map(tagObj => tagObj.name),
// NEW: ვინახავთ ობიექტებსაც, რედაქტირებისთვის
        tagObjects: data.tags || [],
        englishSentences: data.english_sentences || [],
        georgianSentences: data.georgian_sentences || [],
        progress: data.progress || 0,
        updated: data.updated_at || data.updated || Date.now()
    };
// cardData.tags ახლა არის ['tag1', 'tag2']
    const translationHTML = `${cardData.mainTranslations.join(', ')}<span class="extra">${cardData.extraTranslations.join(', ')}</span>`;
    // --- NEW: თეგების შეზღუდვის ლოგიკა (+N) ---
    let tagHTML = '';
    const maxVisibleTags = 3; // ვაჩვენებთ მაქსიმუმ 3 თეგს
    const totalTags = cardData.tags.length;
    // 1. ვაჩვენებთ პირველ 3 თეგს
    tagHTML = cardData.tags.slice(0, maxVisibleTags).map(tag => {
        const color = getColorForTag(tag);
        return `<span class="card-tag" style="background-color: ${color}">${tag}</span>`;
    }).join('');
    // 2. თუ მეტია, ვამატებთ "+N" ბეიჯს
    // 2. თუ მეტია, ვამატებთ "+N" ბეიჯს (თულთიფით დესკტოპისთვის)
    if (totalTags > maxVisibleTags) {
        const hiddenCount = totalTags - maxVisibleTags;
        // --- NEW: ვიღებთ დამალულ თეგებს ---
        const hiddenTags = cardData.tags.slice(maxVisibleTags).join(', '); // მაგ: "Verbs, Food, Travel"
        // --- END NEW ---
        // ვამატებთ ბეიჯს და ვსვამთ `title` ატრიბუტს
        tagHTML += ` <span class="card-tag-more" title="${hiddenTags}">+${hiddenCount}</span>`;
    }
    // --- END NEW LOGIC ---
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
<div class="card-header">
<div class="card-header">
<button class="speak-btn" title="წაიკითხე სიტყვა" data-word="${cardData.word}"><i class="fas fa-volume-up"></i></button>
<h2 class="word">${cardData.word}</h2>
</div>
<div class="card-actions">
<i class="fas fa-edit"></i>
<i class="fas fa-trash-alt"></i>
</div>
</div>
<p class="translation">${translationHTML}</p>
<div class="tags">${tagHTML}</div>
<div class="progress-bar-container">
<div class="progress-bar" style="width: ${cardData.progress}%;"></div>
<span class="progress-label">${(parseFloat(cardData.progress || 0)).toFixed(1)}%</span>
</div>
`;
    card.dataset.id = cardData.id;
    card.dataset.progress = cardData.progress;
    card.dataset.updated = new Date(cardData.updated).getTime();
    card.dataset.english = JSON.stringify(cardData.englishSentences);
    card.dataset.georgian = JSON.stringify(cardData.georgianSentences);
// NEW: ვინახავთ თეგის ობიექტებს DOM-ში რედაქტირებისთვის
    card.dataset.tagObjects = JSON.stringify(cardData.tagObjects);
// სტილიზაცია ჩატვირთვისას
    const progressBar = card.querySelector('.progress-bar');
    const progressLabel = card.querySelector('.progress-label');
    if (progressBar) {
        progressBar.style.width = `${cardData.progress}%`;
        progressBar.style.backgroundColor = getProgressColor(cardData.progress);
    }
    if (progressLabel) {
        progressLabel.textContent = `${cardData.progress.toFixed(1)}%`;
    }
    if (cardData.progress >= 100) {
        card.classList.add('mastered');
    }
    card.querySelector('.fa-edit').onclick = () => editCard(card);
    card.querySelector('.fa-trash-alt').onclick = () => {
        deleteCard(card);
    };
    addLongPressHandlers(card); // ეს უკვე შეიცავს preview-ს ლოგიკას
    document.getElementById('cardContainer').appendChild(card);
    sortCards();
}
async function speakWithVoice(text, voiceObj, buttonEl = null, extraText = null, highlightEl = null, allowHighlight = false) {
    if (!window.speechSynthesis || !voiceObj) return;
    if (buttonEl && buttonEl === lastSpokenButton && speechSynthesis.speaking) {
        speechSynthesis.cancel();
        if (buttonEl) buttonEl.classList.remove('active');
        if (highlightEl) highlightEl.classList.remove('highlighted-sentence');
        lastSpokenButton = null;
        return;
    }
    lastSpokenButton = buttonEl;
    const speak = (txt, el) => {
        return new Promise(resolve => {
            const utterance = new SpeechSynthesisUtterance(txt);
            utterance.voice = voiceObj;
            utterance.lang = voiceObj.lang;
            const rate = (voiceObj.lang === 'ka-GE')
                ? parseFloat(localStorage.getItem(GEORGIAN_RATE_KEY) || 1)
                : parseFloat(localStorage.getItem(ENGLISH_RATE_KEY) || 1);
            utterance.rate = rate;
            if (buttonEl) buttonEl.classList.add('active');
            if (el && allowHighlight) el.classList.add('highlighted-sentence');
            utterance.onend = () => {
                if (buttonEl) buttonEl.classList.remove('active');
                if (el && allowHighlight) el.classList.remove('highlighted-sentence');
                lastSpokenButton = null;
                resolve();
            };
            speechSynthesis.speak(utterance);
        });
    };
    speechSynthesis.cancel();
    await delay(100);
    if (highlightEl) {
        highlightEl.classList.add('highlighted-sentence');
    }
    await speak(text);
    if (extraText) {
        await delay(50);
        await speak(extraText);
    }
    if (highlightEl) {
        highlightEl.classList.remove('highlighted-sentence');
    }
    if (buttonEl) {
        buttonEl.classList.remove('active');
    }
    lastSpokenButton = null;
}
function speakWord(text, buttonEl) {
    if (!window.speechSynthesis) return;
    if (isSpeaking) {
        speechSynthesis.cancel();
        return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
    }
    isSpeaking = true;
    if (buttonEl) buttonEl.classList.add('active');
    const interval = setInterval(() => {
        if (!speechSynthesis.speaking) {
            clearInterval(interval);
            isSpeaking = false;
            if (buttonEl) buttonEl.classList.remove('active');
        }
    }, 100);
}
function showCardPreview(word, mainTranslations, extraTranslations, tags, englishSentences, georgianSentences) {
    const card = [...document.querySelectorAll('.card')].find(c =>
        c.querySelector('.word').textContent.trim().toLowerCase() === word.toLowerCase()
    );
    if (card) {
        updateCardProgress(card, 0.1);
        applyCurrentSort?.();
    }
    const previewWordEl = document.getElementById('previewWord');
    previewWordEl.innerHTML = `${word} <button class="speak-btn" title="წაიკითხე სიტყვა" data-word="${word}"><i class="fas fa-volume-up"></i></button>`;
    const main = mainTranslations.join('; ');
    const extra = extraTranslations.length
        ? `<span class="extra">${extraTranslations.join('; ')}</span>`
        : `<span class="extra" style="visibility: hidden;">placeholder</span>`;
    const geoSpeakBtn = `
<button class="speak-btn" title="წაიკითხე ქართულად"
data-text="${mainTranslations.join(', ')}"
data-extra="${extraTranslations.join(', ')}"
data-lang="ka">
<i class="fas fa-volume-up"></i>
</button>`;
    document.getElementById('previewTranslation').innerHTML = main + geoSpeakBtn + extra;
    const tagContainer = document.getElementById('previewTags');
    tagContainer.innerHTML = '';
    tags.forEach(tag => {
        const span = document.createElement('span');
        span.textContent = `${tag}`; // <-- # ამოღებულია
        span.style.backgroundColor = getColorForTag(tag);
        tagContainer.appendChild(span);
    });
    const enBlock = document.getElementById('previewEnglishSentences');
    const geBlock = document.getElementById('previewGeorgianSentences');
    if (enBlock) {
        enBlock.innerHTML = '';
        englishSentences.forEach((s, i) => {
            const p = document.createElement('p');
            p.innerHTML = `<span class="prefix">${i + 1}. </span>${s} <button class="speak-btn" title="Read English" data-text="${s}" data-lang="en"><i class="fas fa-volume-up"></i></button>`;
            enBlock.appendChild(p);
        });
    }
    if (geBlock) {
        geBlock.innerHTML = '';
        georgianSentences.forEach((s, i) => {
            const p = document.createElement('p');
            p.innerHTML = `<span class="prefix">${i + 1}. </span>${s} <button class="speak-btn" title="წაიკითხე ქართულად" data-text="${s}" data-lang="ka"><i class="fas fa-volume-up"></i></button>`;
            geBlock.appendChild(p);
        });
    }
    document.getElementById('cardPreviewModal').style.display = 'flex';
    const allCards = [...document.querySelectorAll('.card')];
    currentCardIndex = allCards.findIndex(c =>
        c.querySelector('.word').textContent.trim().toLowerCase() === word.toLowerCase()
    );
    updateNavButtons();
    const isAutoPlaying = isPlaying;
    document.getElementById('prevCardBtn').style.display = isAutoPlaying ? 'none' : 'inline-block';
    document.getElementById('nextCardBtn').style.display = isAutoPlaying ? 'none' : 'inline-block';
}
function loadCardIntoModal(card) {
    document.getElementById('previewTranslation')?.classList.remove('highlighted-sentence');
    const word = card.querySelector('.word').textContent.trim();
    const translationEl = card.querySelector('.translation');
    const mainPart = translationEl.childNodes[0]?.textContent?.trim() || '';
    const extraPart = translationEl.querySelector('.extra')?.textContent?.trim() || '';
    // --- FIX: ვკითხულობთ თეგებს data-set-დან (სადაც სრული სიაა) ---
    const tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
    const tags = tagObjects.map(tagObj => tagObj.name);
    // --- END FIX ---
    const en = JSON.parse(card.dataset.english || '[]');
    // ...
    const ge = JSON.parse(card.dataset.georgian || '[]');
    const mainTranslations = mainPart ? mainPart.split(',').map(s => s.trim()) : [];
    const extraTranslations = extraPart ? extraPart.split(',').map(s => s.trim()) : [];
    showCardPreview(word, mainTranslations, extraTranslations, tags, en, ge);
    updateNavButtons();
}
function updateCardVisuals(card) {
    const progress = parseFloat(card.dataset.progress || '0');
    const progressBar = card.querySelector('.progress-bar');
    const label = card.querySelector('.progress-label');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        progressBar.style.backgroundColor = getProgressColor(progress);
    }
    if (label) {
        label.textContent = `${progress.toFixed(1)}%`;
    }
    if (progress >= 100) {
        card.classList.add('mastered');
    } else {
        card.classList.remove('mastered');
    }
    const tagSpans = card.querySelectorAll('.card-tag');
    tagSpans.forEach(span => {
        const tag = span.textContent.replace('#', '').trim();
        const color = getColorForTag(tag);
        span.style.backgroundColor = color;
    });
}
function selectCard(card) {
    card.classList.add('selected');
    selectionMode = true;
    updateSelectionUI();
}
function toggleCardSelection(card) {
    card.classList.toggle('selected');
    updateSelectionUI();
}
function updateSelectionUI() {
    const selected = document.querySelectorAll('.card.selected');
    const anyVisible = document.querySelectorAll('.card:not([style*="display: none"])').length;
    const hasSelected = selected.length > 0;
    document.getElementById('deleteSelectedBtn').classList.toggle('visible-button', hasSelected);
    document.getElementById('cancelSelectionBtn').classList.toggle('visible-button', hasSelected);
    document.getElementById('selectAllBtn').classList.toggle('visible-button', hasSelected && selectionMode && anyVisible);
    const toolbarActions = document.querySelector('.toolbar-actions');
    if (hasSelected) {
        toolbarActions.classList.add('visible');
    } else {
        toolbarActions.classList.remove('visible');
    }
    if (!hasSelected) selectionMode = false;
}
function addLongPressHandlers(card) {
    let pressTimer = null;
    let preventClick = false;
    const longPressDuration = 600;
    const onPointerDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        pressTimer = setTimeout(() => {
            preventClick = true;
            selectionMode = true;
            selectCard(card);
            showCancelButton();
        }, longPressDuration);
    };
    const onPointerUpOrLeave = (e) => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };
    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointerup', onPointerUpOrLeave);
    card.addEventListener('pointerleave', onPointerUpOrLeave);
    card.addEventListener('pointercancel', onPointerUpOrLeave);
    card.addEventListener('pointermove', () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    });
// click
// click
    card.addEventListener('click', (e) => {
        if (preventClick) {
            preventClick = false;
            e.preventDefault(); // შეაჩერე ნებისმიერი სხვა კლიკი (მაგ. თეგის)
            return;
        }
        if (selectionMode) {
            toggleCardSelection(card); // თუ მონიშვნის რეჟიმში ვართ, უბრალოდ მონიშნე/მოხსენი
            return; // და არ გახსნა preview
        }
// --- ⬇️ NEW: თეგზე კლიკის დამმუშავებელი ⬇️ ---
        if (e.target.classList.contains('card-tag')) {
// თუ დავაკლიკეთ თეგს
            e.stopPropagation(); // გააჩერე ივენთი, რომ ბარათის preview არ გაიხსნას
            const tag = e.target.textContent.replace('#', '');
// ფილტრაციის ლოგიკა (რომელიც წავშალეთ initializeApp-დან)
            if (activeFilterTags.has(tag)) {
                activeFilterTags.delete(tag);
            } else {
                activeFilterTags.add(tag);
            }
            renderSidebarTags();
            filterCardsByTags();
            return; // დავასრულეთ
        }
// --- ⬆️ NEW: თეგზე კლიკის დასასრული ⬆️ ---
// შევამოწმოთ, ხომ არ დავაკლიკეთ სხვა ღილაკზე
        const isOtherAction = e.target.closest('.card-actions') ||
            e.target.classList.contains('speak-btn') ||
            e.target.closest('.speak-btn');
        if (isOtherAction) {
// მივეცით საშუალება იმოქმედოს (მაგ. edit, delete, speak)
            return;
        }
// თუ აქამდე მოვედით, ეს ნიშნავს, რომ ცარიელ ადგილს დავაჭირეთ -> ვხსნით Preview-ს
// თუ აქამდე მოვედით, ეს ნიშნავს, რომ ცარიელ ადგილს დავაჭირეთ -> ვხსნით Preview-ს
        const word = card.querySelector('.word').textContent;
        const mainPart = card.querySelector('.translation').childNodes[0]?.textContent?.trim() || '';
        const extraPart = card.querySelector('.translation .extra')?.textContent?.trim() || '';
        // --- FIX: ვკითხულობთ თეგებს data-set-დან (სადაც სრული სიაა) და არა DOM-იდან ---
        const tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
        const tags = tagObjects.map(tagObj => tagObj.name); // ვიღებთ სუფთა სახელებს
        // --- END FIX ---
        const mainTranslations = mainPart ? mainPart.split(',').map(s => s.trim()) : [];
        const extraTranslations = extraPart ? extraPart.split(',').map(s => s.trim()) : [];
        const en = JSON.parse(card.dataset.english || '[]');
        const ge = JSON.parse(card.dataset.georgian || '[]');
        showCardPreview(word, mainTranslations, extraTranslations, tags, en, ge);
    });
}
function showCancelButton() {
    document.getElementById('cancelSelectionBtn').style.display = 'inline-block';
    document.getElementById('deleteSelectedBtn').style.display = 'inline-block';
}
function renderTags(container, list, sourceArray, isTranslation) {
    container.innerHTML = '';
    list.forEach((tag, index) => {
        const span = document.createElement('span');
        if (isTranslation) {
            span.className = list === mainTranslations ? 'main-translation-tag' : 'extra-translation-tag';
        } else {
            span.className = 'tag';
            span.style.backgroundColor = getColorForTag(tag);
        }
        if (!isTranslation) {
            span.style.backgroundColor = getColorForTag(tag);
        }
        span.innerHTML = `${tag} <i class="fas fa-times"></i>`;
        span.querySelector('i').onclick = () => {
            sourceArray.splice(index, 1);
            renderTags(container, list, sourceArray, isTranslation);
        };
        container.appendChild(span);
    });
}
function updateNavButtons() {
    const cards = [...document.querySelectorAll('.card')];
    if (shuffleMode) {
        document.getElementById('prevCardBtn').disabled = false;
        document.getElementById('nextCardBtn').disabled = false;
    } else {
        document.getElementById('prevCardBtn').disabled = currentCardIndex <= 0;
        document.getElementById('nextCardBtn').disabled = currentCardIndex >= cards.length - 1;
    }
}
function resetModal() {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('wordInput').value = '';
    document.getElementById('mainTranslationInput').value = '';
    document.getElementById('extraTranslationInput').value = '';
    document.getElementById('tagInput').value = '';
    document.getElementById('englishSentences').value = '';
    document.getElementById('georgianSentences').value = '';
    mainTranslations = [];
    extraTranslations = [];
    tags = [];
    isEditing = false;
    editingCard = null;
    document.getElementById('tagDropdown').style.display = 'none';
    renderTags(document.getElementById('mainTranslationTags'), [], [], true);
    renderTags(document.getElementById('extraTranslationTags'), [], [], true);
    renderTags(document.getElementById('tagList'), [], [], false);
}
function saveToStorage() {
    console.warn("saveToStorage() called, but it's deprecated. Data is not saved to DB.");
}
function loadCardsFromStorage() {
    console.warn("loadCardsFromStorage() called, but it's deprecated. Loading from Supabase instead.");
}
// =======================================================
// ==== 3. აპლიკაციის მთავარი შესასვლელი წერტილი (Entry Point) ====
// =======================================================
// =======================================================
// ==== Supabase Data Functions (CREATE, READ, DELETE) ====
// =======================================================
async function loadDictionaries() {
    if (!currentUser || currentUser.id === 'offline-user') return;
    console.log('[AWorded] loadDictionaries: querying...');
    const {data, error} = await supabaseClient.from('dictionaries').select('*').eq('user_id', currentUser.id).order('created_at');
    console.log('[AWorded] loadDictionaries: result -', data?.length, 'dicts, error:', error?.message || 'none');
    if (error) {
        console.error('[AWorded] loadDictionaries error:', error);
        return;
    }
    allDictionaries = data || [];
    // If no dictionaries exist, create default
    if (allDictionaries.length === 0) {
        const {data: newDict, error: createErr} = await supabaseClient
            .from('dictionaries')
            .insert({user_id: currentUser.id, name: 'English-Georgian'})
            .select()
            .single();
        if (createErr) {
            showToast(`Error creating default dictionary: ${createErr.message}`, "error");
            return;
        }
        allDictionaries = [newDict];
    }
    // Restore last selected or default to first
    const savedId = localStorage.getItem(DICTIONARY_KEY);
    const found = allDictionaries.find(d => d.id === savedId);
    currentDictionaryId = found ? found.id : allDictionaries[0].id;
    localStorage.setItem(DICTIONARY_KEY, currentDictionaryId);
    renderDictionaryDropdown();
}

function renderDictionaryDropdown() {
    const select = document.getElementById('dictionarySelect');
    if (!select) return;
    select.innerHTML = '';
    allDictionaries.forEach(dict => {
        const option = document.createElement('option');
        option.value = dict.id;
        option.textContent = dict.name;
        if (dict.id === currentDictionaryId) option.selected = true;
        select.appendChild(option);
    });
}

async function loadDataFromSupabase(retryCount = 0) {
    if (!currentUser) { console.warn('[AWorded] loadData: no currentUser'); return; }
    if (currentUser.id === 'offline-user') return;
    console.log('[AWorded] loadData: starting, dictionaryId:', currentDictionaryId, 'retry:', retryCount);
    if (!currentDictionaryId) {
        console.error('[AWorded] loadData: currentDictionaryId is null/undefined!');
        return;
    }
// 1. ვიღებთ *ყველა* მონაცემს პარალელურად
    let cardsResponse, tagsResponse, relationsResponse;
    try {
        [cardsResponse, tagsResponse, relationsResponse] = await Promise.all([
            supabaseClient.from('cards').select('*').eq('user_id', currentUser.id).eq('dictionary_id', currentDictionaryId),
            supabaseClient.from('tags').select('*').eq('user_id', currentUser.id),
            supabaseClient.from('card_tags').select('*') // user_id-ს RLS პოლისი ამოწმებს
        ]);
    } catch (networkError) {
        if (retryCount < 2) {
            console.warn(`Network error loading data, retrying (${retryCount + 1})...`);
            await new Promise(r => setTimeout(r, 1500));
            return loadDataFromSupabase(retryCount + 1);
        }
        showToast('ქსელის შეცდომა. გადატვირთეთ გვერდი.', 'error');
        return;
    }
// შეცდომების დამუშავება
    if (cardsResponse.error || tagsResponse.error || relationsResponse.error) {
        const errMsg = cardsResponse.error?.message || tagsResponse.error?.message || relationsResponse.error?.message;
        if (retryCount < 2) {
            console.warn(`Error loading data, retrying (${retryCount + 1})...`);
            await new Promise(r => setTimeout(r, 1500));
            return loadDataFromSupabase(retryCount + 1);
        }
        showToast(`Error loading data: ${errMsg}`, "error");
        return;
    }
    const cards = cardsResponse.data;
    const tags = tagsResponse.data;
    const relations = relationsResponse.data;
// 2. ვასუფთავებთ UI-ს და გლობალურ სიებს
    document.getElementById('cardContainer').innerHTML = '';
    allTags.clear();
// 3. ვავსებთ 'allTags' სიას ბაზიდან მოსული თეგებით
// allTags ახლა ინახავს Set<TagObject>, და არა Set<string>
    const tagMap = new Map(); // სწრაფი ძებნისთვის
    tags.forEach(tag => {
        allTags.add(tag); // tag არის ობიექტი: {id: 1, name: 'work', ...}
        tagMap.set(tag.id, tag.name);
    });
// 4. ვამატებთ თეგებს ბარათებს
    const cardsWithTags = cards.map(card => {
// 1. იპოვე ამ ბარათის თეგის ID-ები
        const relatedTagIds = relations
            .filter(r => r.card_id === card.id)
            .map(r => r.tag_id);
// 2. გადააქციე ID-ები თეგის ობიექტებად
        card.tags = relatedTagIds.map(tagId => {
            return {id: tagId, name: tagMap.get(tagId)}
        }).filter(Boolean); // .filter(Boolean) შლის წაშლილ/არარსებულ თეგებს
        return card;
    });
// 5. ვხატავთ ბარათებს და ვავსებთ UI-ს
    cardsWithTags.forEach(card => {
        renderCardFromData(card);
    });
    renderSidebarTags();
    populateGlobalTags();
    if (document.getElementById('quizTab')) {
        populateQuizTags();
    }
}
async function deleteCard(card) {
    const cardId = card.dataset.id;
    if (!cardId) {
        showToast("Cannot delete card: Missing ID", "error");
        return;
    }
    if (!confirm("ნამდვილად გსურთ ამ ბარათის წაშლა?")) return;
    const {error} = await supabaseClient
        .from('cards')
        .delete()
        .eq('id', cardId);
    if (error) {
        showToast(`Delete failed: ${error.message}`, "error");
    } else {
        card.remove();
        showToast("ბარათი წაიშალა", "success");
    }
}
// defer script — DOM is already parsed, no need for DOMContentLoaded
(async () => {
// ==== EARLY: Dark mode applied immediately before auth ====
    {
        const savedTheme = localStorage.getItem("theme");
        const logoEl = document.getElementById("appLogo");
        const toggleBtn = document.getElementById("toggleDarkModeBtn");
        if (savedTheme === "dark") {
            document.body.classList.add("dark");
            if (toggleBtn) toggleBtn.innerHTML = `<i class="fas fa-sun"></i>`;
            if (logoEl) logoEl.data = "/icons/logo-dark.svg";
        }
    }
// ==== 3a. DOM ელემენტების შენახვა ცვლადებში ====
    const authContainer = document.getElementById('authContainer');
    const mainAppContainer = document.getElementById('mainAppContainer');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const authMessage = document.getElementById('authMessage');
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const addCardBtn = document.getElementById('addCardBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
    const modalOverlay = document.getElementById('modalOverlay');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveCardBtn = document.getElementById('saveCardBtn');
    const cardContainer = document.getElementById('cardContainer');
    const wordInput = document.getElementById('wordInput');
    const mainTranslationInput = document.getElementById('mainTranslationInput');
    const addMainTranslationBtn = document.getElementById('addMainTranslationBtn');
    const extraTranslationInput = document.getElementById('extraTranslationInput');
    const addExtraTranslationBtn = document.getElementById('addExtraTranslationBtn');
    const tagInput = document.getElementById('tagInput');
    const addTagBtn = document.getElementById('addTagBtn');
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebar = document.getElementById('sidebar');
    const searchInput = document.getElementById('searchInput');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const englishSentencesInput = document.getElementById('englishSentences');
    const georgianSentencesInput = document.getElementById('georgianSentences');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveVoiceBtn = document.getElementById('saveVoiceBtn');
    const prevBtn = document.querySelector('.player .fa-backward-step').closest('button');
    const nextBtn = document.querySelector('.player .fa-forward-step').closest('button');
    const mobileSidebarBtn = document.getElementById('mobileSidebarBtn');
    const statsBtn = document.getElementById('statsBtn');
    const statsModal = document.getElementById('statsModal');
    const closeStatsBtn = document.getElementById('closeStatsBtn');
    const shuffleBtn = document.querySelector('.player .fa-shuffle').closest('button');
    const previewModal = document.getElementById('cardPreviewModal');
    const sortSelect = document.getElementById('sortSelect');
    const sortIcon = document.getElementById('sortDirectionIcon');
    const playBtn = document.querySelector('.player .fa-play').closest('button');
    const stopBtn = document.querySelector('.player .fa-stop').closest('button');
    const closePreviewBtn = document.getElementById('closePreviewBtn');
// --- NEW PLAYER DOM ELEMENTS ---
    const minimizePlayerBtn = document.getElementById('minimizePlayerBtn');
    const playerMinimizedDisplay = document.getElementById('playerMinimizedDisplay');
    // --- END NEW ---
// ==== 3b. ფუნქციები, რომლებიც იყენებენ ამ ელემენტებს ====
// ფუნქცია, რომელიც ირთვება დალოგინების შემდეგ
// ფუნქცია, რომელიც ირთვება დალოგინების შემდეგ
// ფუნქცია, რომელიც ირთვება დალოგინების შემდეგ
    async function initializeApp() { // <-- გახდა ASYNC
        console.log('[AWorded] initializeApp started, user:', currentUser?.email);
        try {
            mainAppContainer.style.display = 'block';
            authContainer.style.display = 'none';
            userEmailDisplay.textContent = currentUser.email;
        } catch(e) { console.error('[AWorded] CRASH at UI setup:', e); }
        try {
            const stored = localStorage.getItem(TEXTAREA_STORAGE_KEY);
            const btn = document.getElementById("downloadTemplateBtn");
            const quizTab = document.getElementById('quizTab');
            if (quizTab) {
                createQuizUI();
            }
            if (btn) {
                btn.addEventListener("click", () => {
                    const templateData = [
                        ["Word", "MainTranslations", "ExtraTranslations", "Tags", "EnglishSentences", "GeorgianSentences"]
                    ];
                    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
                    XLSX.writeFile(workbook, "template.xlsx");
                });
            }
            document.addEventListener('click', () => {
                loadVoices();
                loadVoicesWithDelay();
            }, {once: true});
            if (stored) {
                const data = JSON.parse(stored);
                if (englishSentencesInput) englishSentencesInput.value = data.english || '';
                if (georgianSentencesInput) georgianSentencesInput.value = data.georgian || '';
            }
            if (closePreviewBtn && previewModal) {
                closePreviewBtn.addEventListener('click', () => {
                    previewModal.style.display = 'none';
                });
            }
        } catch(e) { console.error('[AWorded] CRASH at pre-load setup:', e); }
        console.log('[AWorded] pre-load setup done, loading data...');
// *** ლექსიკონების და მონაცემების ჩატვირთვა ბაზიდან ***
        await loadDictionaries();
        if (currentDictionaryId) {
            await loadDataFromSupabase();
        }
        console.log('[AWorded] Initial load complete. Dictionary:', currentDictionaryId, 'Cards:', document.querySelectorAll('.card').length);
// Dictionary switching
        const dictionarySelect = document.getElementById('dictionarySelect');
        if (dictionarySelect) {
            dictionarySelect.onchange = async () => {
                currentDictionaryId = dictionarySelect.value;
                localStorage.setItem(DICTIONARY_KEY, currentDictionaryId);
                await loadDataFromSupabase();
                sortCards();
            };
        }
// Dictionary creation
        const addDictionaryBtn = document.getElementById('addDictionaryBtn');
        if (addDictionaryBtn) {
            addDictionaryBtn.onclick = async () => {
                const name = prompt('ლექსიკონის სახელი:');
                if (!name || !name.trim()) return;
                const {data, error} = await supabaseClient
                    .from('dictionaries')
                    .insert({user_id: currentUser.id, name: name.trim()})
                    .select()
                    .single();
                if (error) {
                    showToast(`შეცდომა: ${error.message}`, "error");
                    return;
                }
                allDictionaries.push(data);
                currentDictionaryId = data.id;
                localStorage.setItem(DICTIONARY_KEY, currentDictionaryId);
                renderDictionaryDropdown();
                await loadDataFromSupabase();
                sortCards();
                showToast(`ლექსიკონი "${name.trim()}" შეიქმნა`, "success");
            };
        }
// Notifications
        if (typeof initNotificationUI === 'function') {
            initNotificationUI();
            registerNotificationSW();
        }
// NEW: ჩავტვირთოთ შენახული სორტირების რეჟიმი
        const savedSortMode = localStorage.getItem(SORT_MODE_KEY);
        if (savedSortMode) {
            currentSortMode = savedSortMode;
            sortSelect.value = savedSortMode; // განვაახლოთ dropdown-ის UI
        }
        sortCards(); // <-- და მხოლოდ ამის მერე ვალაგებთ
        if (sortIcon) {
            sortIcon.classList.remove('fa-sort-up', 'fa-sort-down');
            sortIcon.classList.add(sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
        }
        document.addEventListener('click', function (e) {
            const tagDropdown = document.getElementById('tagDropdown');
// const tagInput = ... // <-- უკვე გვაქვს
            const tagInputFocused = tagInput.contains(e.target);
            const dropdownFocused = tagDropdown.contains(e.target);
            if (!tagInputFocused && !dropdownFocused) {
                tagDropdown.style.display = 'none';
            }
        });
        tagInput.addEventListener('blur', () => { // <-- ვიყენებთ არსებულ tagInput ცვლადს
            setTimeout(() => {
                document.getElementById('tagDropdown').style.display = 'none';
            }, 200);
        });
// --- ⬇️ DARK MODE-ის გასწორებული ლოგიკა ⬇️ ---
// 1. თემის წაკითხვა და დაყენება ჩატვირთვისას
        const savedTheme = localStorage.getItem("theme");
        const logoEl = document.getElementById("appLogo");
        const toggleBtn = document.getElementById("toggleDarkModeBtn"); // ეს ცვლადი უკვე არსებობს, მაგრამ აქ გვჭირდება
        if (savedTheme === "dark") {
            document.body.classList.add("dark");
            toggleBtn.innerHTML = `<i class="fas fa-sun"></i>`;
            if (logoEl) {
                logoEl.data = "/icons/logo-dark.svg";
            }
        } else {
// ეს ბლოკი აკლდა:
            document.body.classList.remove("dark");
            toggleBtn.innerHTML = `<i class="fas fa-moon"></i>`;
            if (logoEl) {
                logoEl.data = "/icons/logo.svg";
            }
        }
// 2. კლიკზე თემის შენახვა (ეს კოდი ისედაც სწორი იყო)
        toggleBtn.addEventListener("click", () => {
            document.body.classList.toggle("dark");
            const isDark = document.body.classList.contains("dark");
            localStorage.setItem("theme", isDark ? "dark" : "light");
            toggleBtn.innerHTML = `<i class="fas fa-${isDark ? 'sun' : 'moon'}"></i>`;
// განვაახლოთ ლოგოს ცვლადი, რადგან DOM შეიძლება შეიცვალოს
            const currentLogoEl = document.getElementById("appLogo");
            if (currentLogoEl) {
                currentLogoEl.data = isDark ? "/icons/logo-dark.svg" : "/icons/logo.svg";
            }
        });
// --- ⬆️ DARK MODE-ის ლოგიკის დასასრული ⬆️ ---
        document.addEventListener('mousedown', function (e) {
// ვიყენებთ არსებულ ცვლადებს (sidebar, toggleSidebarBtn)
            const clickedInsideSidebar = sidebar.contains(e.target);
            const clickedToggleBtn = toggleSidebarBtn.contains(e.target); // <-- ვასწორებთ 'toggleBtn'-ს
            if (!clickedInsideSidebar && !clickedToggleBtn) {
                sidebar.classList.remove('active');
            }
        });
    }
// ფუნქცია, რომელიც რთავს Auth UI-ს
// ფუნქცია, რომელიც რთავს Auth UI-ს
    function showAuthScreen() {
        mainAppContainer.style.display = 'none';
        authContainer.style.display = 'flex';
        userEmailDisplay.textContent = '';
        cardContainer.innerHTML = '';
        allTags.clear();
        isAppInitialized = false; // NEW: ვანულებთ ალამს
    }
// ==== 3c. ივენთების მიბმა (Event Listeners) ====
// Auth
    loginBtn.onclick = async () => {
        authMessage.textContent = '';
        const {error} = await supabaseClient.auth.signInWithPassword({
            email: authEmail.value,
            password: authPassword.value,
        });
        if (error) {
            authMessage.textContent = 'Email ან პაროლი არასწორია.';
        }
    };
    registerBtn.onclick = async () => {
        authMessage.textContent = '';
        const {data, error} = await supabaseClient.auth.signUp({
            email: authEmail.value,
            password: authPassword.value,
        });
        if (error) {
            authMessage.textContent = error.message;
        } else {
            authMessage.textContent = 'რეგისტრაცია წარმატებულია! გთხოვთ, დაადასტუროთ იმეილი და შემდეგ შეხვიდეთ სისტემაში.';
        }
    };
    logoutBtn.onclick = async () => {
        await supabaseClient.auth.signOut();
    };
// Skip Login (Offline mode)
    const skipAuthBtn = document.getElementById('skipAuthBtn');
    if (skipAuthBtn) {
        skipAuthBtn.onclick = async () => {
            currentUser = { id: 'offline-user', email: 'Offline Mode' };
            if (!isAppInitialized) {
                isAppInitialized = true;
                await initializeApp();
            }
        };
    }
// Stats
    statsBtn.onclick = () => {
        updateStatsModal();
        statsModal.style.display = 'flex';
    };
    closeStatsBtn.onclick = () => {
        statsModal.style.display = 'none';
    };
    document.getElementById('resetStatsBtn')?.addEventListener('click', async () => {
        if (!confirm("ნამდვილად გსურს ყველა ბარათის პროგრესის განულება?")) return;
        if (!currentUser) return;
// 1. ვასუფთავებთ ლოკალურ სტატისტიკას (ტესტები)
        localStorage.removeItem('TOTAL_TESTS');
        localStorage.removeItem('TOTAL_CORRECT');
        localStorage.removeItem('TOTAL_WRONG');
// 2. ვანულებთ პროგრესს ბაზაში
// ვეუბნებით Supabase-ს: განაახლე "cards" ცხრილი,
// დააყენე progress = 0
// სადაც user_id ემთხვევა ჩვენსას.
        const {data, error} = await supabaseClient
            .from('cards')
            .update({progress: 0})
            .eq('user_id', currentUser.id)
            .eq('dictionary_id', currentDictionaryId);
        if (error) {
            showToast(`პროგრესის განულება ვერ მოხერხდა: ${error.message}`, "error");
            return;
        }
// 3. თუ წარმატებულია, განვაახლოთ UI (ეკრანი)
        document.querySelectorAll('.card').forEach(card => {
            card.dataset.progress = '0';
            const progressBar = card.querySelector('.progress-bar');
            const progressLabel = card.querySelector('.progress-label');
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.style.backgroundColor = getProgressColor(0); // დავუბრუნოთ საწყისი ფერი
            }
            if (progressLabel) progressLabel.textContent = '0%';
            card.classList.remove('mastered'); // მოვაშოროთ "ნასწავლის" კლასი
        });
// 4. განვაახლოთ სტატისტიკის მოდალი
        updateStatsModal?.();
        showToast("პროგრესი განულებულია", "success");
    });
// Player
    nextBtn.onclick = async () => {
        const cards = getVisibleCards();
        if (cards.length === 0) return;
        if (shuffleMode) {
            if (playedIndices.length >= cards.length) return;
            let nextIndex;
            do {
                nextIndex = Math.floor(Math.random() * cards.length);
            } while (playedIndices.includes(nextIndex));
            currentCardIndex = nextIndex;
            playedIndices.push(currentCardIndex);
        } else {
            const currentCard = document.querySelector('.card.playing');
            const indexInVisible = cards.indexOf(currentCard);
            if (indexInVisible === -1 || indexInVisible >= cards.length - 1) return;
            currentCardIndex = indexInVisible + 1;
        }
        const card = cards[currentCardIndex];
        document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
        card.classList.add('playing');
        card.scrollIntoView({behavior: 'smooth', block: 'center'});
        // --- NEW LOGIC (FIX) ---
        updateMinimizedDisplay(card); // 1. განვაახლოთ ჩაკეცილი ტექსტი
        // 2. ხელით გადართვისას მოდალი აღარ ამოდის (შენი მოთხოვნა)
        // if (!previewManuallyClosed && isPlaying) {
        //     loadCardIntoModal(card);
        // }
        // --- END NEW LOGIC (FIX) ---
        speechSynthesis.cancel();
        if (isPlaying) {
            await speakPreviewCard(card);
            if (!shuffleMode) currentCardIndex++;
            startAutoPlay();
        }
    };
    prevBtn.onclick = async () => {
        const cards = getVisibleCards();
        if (cards.length === 0) return;
        if (shuffleMode) {
            if (playedIndices.length <= 1) return;
            playedIndices.pop();
            currentCardIndex = playedIndices[playedIndices.length - 1];
        } else {
            const currentCard = document.querySelector('.card.playing');
            const indexInVisible = cards.indexOf(currentCard);
            if (indexInVisible <= 0) return;
            currentCardIndex = indexInVisible - 1;
        }
        const card = cards[currentCardIndex];
        document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
        card.classList.add('playing');
        card.scrollIntoView({behavior: 'smooth', block: 'center'});
        // --- NEW LOGIC (FIX) ---
        updateMinimizedDisplay(card); // 1. განვაახლოთ ჩაკეცილი ტექსტი
        // 2. ხელით გადართვისას მოდალი აღარ ამოდის
        // if (!previewManuallyClosed && isPlaying) {
        //     loadCardIntoModal(card);
        // }
        // --- END NEW LOGIC (FIX) ---
        speechSynthesis.cancel();
        if (isPlaying) {
            await speakPreviewCard(card);
            if (!shuffleMode) currentCardIndex++;
            startAutoPlay();
        }
    };
    shuffleBtn.onclick = () => {
        shuffleMode = !shuffleMode;
        shuffleBtn.classList.toggle('active', shuffleMode);
        if (shuffleMode) {
            playedIndices = [];
        } else {
            const modalVisible = document.getElementById('cardPreviewModal').style.display === 'flex';
            if (modalVisible) {
                const cards = getVisibleCards();
                if (currentCardIndex < cards.length - 1) {
                    currentCardIndex++;
                    loadCardIntoModal(cards[currentCardIndex]);
                }
            }
        }
    };
    playBtn.onclick = () => {
        if (isPlaying) return;
// --- NEW: დაკვრა იწყება გახსნილი ---
        isPlayerMinimized = false;
        playerMinimizedDisplay.style.display = 'none';
        // --- END NEW ---
// --- ⬇️ NEW: ვანულებთ ინდექსს დაკვრის დაწყებამდე ⬇️ ---
        if (shuffleMode) {
// თუ shuffle ჩართულია, ვასუფთავებთ ნანახი სიტყვების სიას
            playedIndices = [];
        } else {
// თუ ჩვეულებრივი რეჟიმია, ყოველთვის ვიწყებთ ნულიდან
            currentCardIndex = 0;
        }
// --- ⬆️ NEW: ლოგიკის დასასრული ⬆️ ---
        isPlaying = true;
        stopRequested = false;
        previewManuallyClosed = false; // დაუშვას მოდალის გამოჩენა თავიდან
        playBtn.classList.add('active');
        startAutoPlay().then(() => {
            isPlaying = false;
            playBtn.classList.remove('active');
        });
    };
    stopBtn.onclick = () => {
        isPlaying = false;
// --- NEW: ვასუფთავებთ მდგომარეობას ---
        isPlayerMinimized = false;
        playerMinimizedDisplay.style.display = 'none';
        // --- END NEW ---
        stopRequested = true;
        playBtn.classList.remove('active');
        speechSynthesis.cancel();
        document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
        document.querySelectorAll('.highlighted-sentence').forEach(el => el.classList.remove('highlighted-sentence'));
        if (currentSortMode === 'progress') {
            sortCards();
        }
    };
// --- NEW PLAYER LISTENERS (FIXED) ---
    minimizePlayerBtn.onclick = () => {
        if (!isPlaying) return; // მუშაობს მხოლოდ დაკვრის დროს
        isPlayerMinimized = true;
        previewModal.style.display = 'none'; // დავმალოთ მოდალი
        playerMinimizedDisplay.style.display = 'block'; // ვაჩვენოთ ჩაკეცილი
    };
    playerMinimizedDisplay.onclick = () => {
        if (!isPlaying) return; // მუშაობს მხოლოდ დაკვრის დროს
        isPlayerMinimized = false;
        playerMinimizedDisplay.style.display = 'none'; // დავმალოთ ჩაკეცილი
        // --- NEW: ვტვირთავთ *მიმდინარე* სიტყვას მოდალში ---
        const cards = getVisibleCards();
        if (cards[currentCardIndex]) {
            loadCardIntoModal(cards[currentCardIndex]);
            previewModal.style.display = 'flex'; // ვაჩვენოთ მოდალი
        }
        // --- END NEW ---
    };
    // --- END NEW PLAYER LISTENERS (FIXED) ---
// Settings
    settingsBtn.onclick = () => {
        populateVoiceDropdown();
        loadSpeechRates();
        settingsModal.style.display = 'flex';
    };
    closeSettingsBtn.onclick = () => {
        settingsModal.style.display = 'none';
    };
    saveVoiceBtn.onclick = () => {
        const voiceSelect = document.getElementById('voiceSelect');
        const georgianVoiceSelect = document.getElementById('georgianVoiceSelect');
        const englishRateSlider = document.getElementById('englishRateSlider');
        const georgianRateSlider = document.getElementById('georgianRateSlider');
        const selected = voiceSelect.value;
        localStorage.setItem(VOICE_STORAGE_KEY, selected);
        selectedVoice = speechSynthesis.getVoices().find(v => v.name === selected);
        const geoSelected = georgianVoiceSelect.value;
        localStorage.setItem(GEORGIAN_VOICE_KEY, geoSelected);
        selectedGeorgianVoice = speechSynthesis.getVoices().find(v => v.name === geoSelected);
        localStorage.setItem(ENGLISH_RATE_KEY, englishRateSlider.value);
        localStorage.setItem(GEORGIAN_RATE_KEY, georgianRateSlider.value);
        settingsModal.style.display = 'none';
    };
// Textareas
    englishSentencesInput.addEventListener('input', saveTextareaToLocalStorage);
    georgianSentencesInput.addEventListener('input', saveTextareaToLocalStorage);
    setupSmartNumbering(englishSentencesInput);
    setupSmartNumbering(georgianSentencesInput);
// Selection
    selectAllBtn.onclick = () => {
        const visibleCards = [...document.querySelectorAll('.card')].filter(card => card.style.display !== 'none');
        visibleCards.forEach(card => card.classList.add('selected'));
        selectionMode = true;
        updateSelectionUI();
    };
    deleteSelectedBtn.onclick = async () => {
        const selectedCards = document.querySelectorAll('.card.selected');
        if (selectedCards.length === 0) return;
        if (!confirm(`ნამდვილად გსურთ ${selectedCards.length} ბარათის წაშლა?`)) return;
// 1. შევაგროვოთ ყველა მონიშნული ბარათის ID
        const cardIdsToDelete = [...selectedCards].map(card => card.dataset.id).filter(Boolean);
        if (cardIdsToDelete.length === 0) {
            showToast("წაშლა ვერ მოხერხდა: ID-ები ვერ მოიძებნა", "error");
            return;
        }
// 2. გავუშვათ ერთი მოთხოვნა ბაზაში
        const {error} = await supabaseClient
            .from('cards')
            .delete()
            .in('id', cardIdsToDelete); // წაშალე ყველა, ვისი ID-ც ამ სიაშია
        if (error) {
            showToast(`წაშლა ვერ მოხერხდა: ${error.message}`, "error");
        } else {
// 3. თუ წარმატებულია, წავშალოთ DOM-იდან
            selectedCards.forEach(card => card.remove());
            selectionMode = false;
            updateSelectionUI();
            showToast(`${cardIdsToDelete.length} ბარათი წაიშალა`, "success");
        }
    };
    cancelSelectionBtn.onclick = () => {
        document.querySelectorAll('.card.selected').forEach(card => card.classList.remove('selected'));
        selectionMode = false;
        updateSelectionUI();
    };
// Sidebar
    toggleSidebarBtn.onclick = () => {
        sidebar.classList.toggle('active');
        renderSidebarTags();
    };
    closeSidebarBtn.onclick = () => {
        sidebar.classList.remove('active');
    };
    mobileSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        activeFilterTags.clear();
        renderSidebarTags();
        filterCardsByTags();
    });
    document.getElementById('clearTagFiltersBtn').onclick = () => {
        activeFilterTags.clear();
        renderSidebarTags();
        filterCardsByTags();
    };
// Preview Modal
    previewModal.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });
    previewModal.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipeGesture();
    });
    // --- UPDATED Close Preview Button ---
    closePreviewBtn.onclick = () => {
        previewModal.style.display = 'none';
        previewManuallyClosed = true;
        if (isPlaying) {
            // 1. თუ ფლეერი მუშაობს, უბრალოდ "ჩავკეცოთ"
            isPlayerMinimized = true;
            playerMinimizedDisplay.style.display = 'block'; // ვაჩვენოთ ჩაკეცილი
        } else {
            // 2. თუ ფლეერი *არ* მუშაობს (მანუალური რეჟიმია), უბრალოდ გავაჩეროთ ხმა
            speechSynthesis.cancel();
            document.querySelectorAll('.highlighted-sentence').forEach(el => el.classList.remove('highlighted-sentence'));
        }
        // შენიშვნა: isPlaying=false და stopRequested=true აქედან ამოღებულია!
        // ფლეერი გაჩერდება მხოლოდ "Stop" ღილაკით ან როცა დაასრულებს დაკვრას.
    };
    previewModal.addEventListener('click', function (e) {
        if (e.target === this) {
            // დავაკლიკეთ Overlay-ზე, ვბაძავთ "X" ღილაკის ახალ ლოგიკას
            previewModal.style.display = 'none';
            previewManuallyClosed = true;
            if (isPlaying) {
                // 1. თუ ფლეერი მუშაობს, "ვკეცავთ"
                isPlayerMinimized = true;
                playerMinimizedDisplay.style.display = 'block';
            } else {
                // 2. თუ მანუალურია, ვთიშავთ ხმას
                speechSynthesis.cancel();
                document.querySelectorAll('.highlighted-sentence').forEach(el => el.classList.remove('highlighted-sentence'));
            }
        }
    });
    document.getElementById('prevCardBtn').onclick = () => {
        const cards = getVisibleCards();
        if (!cards.length) return;
        if (shuffleMode) {
            let randomIndex;
            do {
                randomIndex = Math.floor(Math.random() * cards.length);
            } while (randomIndex === currentCardIndex);
            currentCardIndex = randomIndex;
        } else {
            if (currentCardIndex > 0) {
                currentCardIndex--;
            }
        }
        loadCardIntoModal(cards[currentCardIndex]);
    };
    document.getElementById('nextCardBtn').onclick = () => {
        const cards = getVisibleCards();
        if (!cards.length) return;
        if (shuffleMode) {
            let randomIndex;
            do {
                randomIndex = Math.floor(Math.random() * cards.length);
            } while (randomIndex === currentCardIndex);
            currentCardIndex = randomIndex;
        } else {
            if (currentCardIndex < cards.length - 1) {
                currentCardIndex++;
            }
        }
        loadCardIntoModal(cards[currentCardIndex]);
    };
// Add Card Modal
    addCardBtn.onclick = () => {
        resetModal();
        modalOverlay.style.display = 'flex';
    };
    cancelBtn.onclick = resetModal;
    document.getElementById('closeAddModalBtn').onclick = () => {
        modalOverlay.style.display = 'none';
    };
    saveCardBtn.onclick = async () => {
        const word = wordInput.value.trim();
        if (!word) return;
        if (!currentUser) {
            showToast("User not logged in", "error");
            return;
        }
// 1. მოამზადე მონაცემები
// `tags` არის გლობალური მასივი, რომელიც შეიცავს სტრინგებს, მაგ: ['work', 'new']
        const tagNames = tags;
        const cardData = {
            word_input: word,
            main_translations_input: mainTranslations,
            extra_translations_input: extraTranslations,
            english_sentences_input: englishSentencesInput.value.split('\n').map(line => line.replace(/^\d+\.\s*/, '').trim()).filter(line => line !== ''),
            georgian_sentences_input: georgianSentencesInput.value.split('\n').map(line => line.replace(/^\d+\.\s*/, '').trim()).filter(line => line !== ''),
            tag_names_input: tagNames,
            dictionary_id_input: currentDictionaryId
        };
        if (isEditing && editingCard) {
// === UPDATE (განახლება) ===
            const cardId = editingCard.dataset.id;
            if (!cardId) {
                showToast("Error updating card: Missing card ID", "error");
                return;
            }
// RPC ფუნქციას ვამატებთ ბარათის ID-ს
            cardData.card_id_input = cardId;
            const {data, error} = await supabaseClient
                .rpc('update_card_with_tags', cardData)
                .select()
                .single();
            if (error) {
                showToast(`Update failed: ${error.message}`, "error");
            } else {
// UI განახლება
// ბაზიდან დაბრუნებულ ბარათს (data) დავამატოთ თეგები UI-სთვის
                data.tags = tagNames.map(name => {
                    return [...allTags].find(tagObj => tagObj.name === name) || {name: name};
                }).filter(Boolean);
// წავშალოთ ძველი ბარათი
                editingCard.remove();
// დავხატოთ ახალი (განახლებული)
                renderCardFromData(data);
                resetModal();
                showToast("ბარათი განახლდა", "success");
            }
        } else {
// === CREATE (შექმნა) ===
            const duplicateExists = [...document.querySelectorAll('.card')].some(card => {
                const cardWord = card.querySelector('.word').textContent.trim().toLowerCase();
                return cardWord === word.toLowerCase();
            });
            if (duplicateExists) {
                alert('ასეთი სიტყვა უკვე არსებობს!');
                return;
            }
// ვიძახებთ ჩვენს SQL ფუნქციას
            const {data, error} = await supabaseClient
                .rpc('create_card_with_tags', cardData)
                .select()
                .single();
            if (error) {
                showToast(`Save failed: ${error.message}`, "error");
            } else {
// 'data' არის ახალი ბარათი. დავამატოთ თეგები, რომ renderCard-მა დახატოს
                data.tags = tagNames.map(name => {
                    return [...allTags].find(tagObj => tagObj.name === name) || {name: name};
                }).filter(Boolean);
                renderCardFromData(data);
                resetModal();
                showToast("ბარათი დაემატა", "success");
            }
        }
    };
// Add Translation / Tags
    addMainTranslationBtn.onclick = () => addTranslation(mainTranslationInput, mainTranslations, document.getElementById('mainTranslationTags'));
    addExtraTranslationBtn.onclick = () => addTranslation(extraTranslationInput, extraTranslations, document.getElementById('extraTranslationTags'));
    mainTranslationInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') addMainTranslationBtn.click();
    });
    extraTranslationInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') addExtraTranslationBtn.click();
    });
    tagInput.addEventListener('focus', () => showTagDropdown(''));
    tagInput.addEventListener('input', () => showTagDropdown(tagInput.value.trim().toLowerCase()));
    tagInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') addTagBtn.click();
    });
    addTagBtn.onclick = async () => {
        const val = tagInput.value.trim();
        if (!val || tags.includes(val)) return;
// 1. შევამოწმოთ, ხომ არ არსებობს უკვე გლობალურად
        let tagObj = [...allTags].find(tag => tag.name.toLowerCase() === val.toLowerCase());
        if (!tagObj) {
// თუ არ არსებობს, შევქმნათ ბაზაში
            const {data, error} = await supabaseClient
                .from('tags')
                .insert({user_id: currentUser.id, name: val})
                .select()
                .single();
            if (error) {
                showToast(`თეგის დამატება ვერ მოხერხდა: ${error.message}`, "error");
                return;
            }
            tagObj = data;
            allTags.add(tagObj); // დავამატოთ გლობალურ სიაში
        }
// 2. დავამატოთ მოდალის ლოკალურ სიაში (სახელი)
        tags.push(tagObj.name);
        renderTags(document.getElementById('tagList'), tags, tags, false);
        tagInput.value = '';
        document.getElementById('tagDropdown').style.display = 'none';
    };
// Top Bar
    document.getElementById('showTopBtn').addEventListener('click', () => {
        document.querySelector('.top').classList.toggle('show');
    });
    if (window.innerWidth <= 768) {
        document.addEventListener('click', function (e) {
            const topBar = document.querySelector('.top');
            const toggleBtn = document.getElementById('showTopBtn');
            const clickedInsideTopBar = topBar.contains(e.target);
            const clickedToggleBtn = toggleBtn.contains(e.target);
            if (!clickedInsideTopBar && !clickedToggleBtn) {
                topBar.classList.remove('show');
            }
        });
    }
// Sorting / Filtering
// Sorting / Filtering
    sortSelect.addEventListener('change', () => {
        currentSortMode = sortSelect.value;
        localStorage.setItem(SORT_MODE_KEY, currentSortMode); // NEW
        sortCards();
    });
// NEW: დავამატეთ listener-ი "ნასწავლის დამალვის" ჩამრთველზე
    document.getElementById('hideMasteredCheckbox').addEventListener('change', () => {
        filterCardsByTags(); // ეს ფუნქცია უკვე ითვალისწინებს ამ ჩამრთველს
    });
    sortIcon.addEventListener('click', () => {
        sortOrder = (sortOrder === 'asc') ? 'desc' : 'asc';
        sortCards();
        sortIcon.classList.remove('fa-sort-up', 'fa-sort-down');
        sortIcon.classList.add(sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
    });
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        document.querySelectorAll('.card').forEach(card => {
            const word = card.querySelector('.word').textContent.toLowerCase();
            const translation = card.querySelector('.translation').textContent.toLowerCase();
            const tags = card.querySelector('.tags').textContent.toLowerCase();
            const matches = word.includes(query) || translation.includes(query) || tags.includes(query);
            card.style.display = matches ? 'block' : 'none';
        });
    });
// Training Modal
    document.getElementById('trainingBtn').addEventListener('click', () => {
        document.getElementById('trainingModal').classList.remove('hidden');
    });
    document.querySelector('.training-close').addEventListener('click', () => {
        document.getElementById('trainingModal').classList.add('hidden');
    });
    document.querySelectorAll('.training-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.training-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const selected = tab.dataset.tab;
            document.querySelectorAll('.training-tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            document.querySelector(`[data-tab-content="${selected}"]`).classList.remove('hidden');
        });
    });
// Excel Import/Export
    document.getElementById('exportExcelBtn').onclick = () => {
        // ... (export logic is fine)
        const cards = [...document.querySelectorAll('.card')].map(card => {
            const word = card.querySelector('.word').textContent.trim();
            const mainText = card.querySelector('.translation').childNodes[0]?.textContent?.trim() || '';
            const extraText = card.querySelector('.translation .extra')?.textContent?.trim() || '';
            // --- FIX: ვკითხულობთ თეგებს data-set-დან (სადაც სრული სიაა) ---
            const tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
            const tags = tagObjects.map(tagObj => tagObj.name).join(', '); // ვწერთ სრულ სიას
            // --- END FIX ---
            const englishSentences = JSON.parse(card.dataset.english || '[]').join('<br>');
            // ...
            const georgianSentences = JSON.parse(card.dataset.georgian || '[]').join('<br>');
            // --- END FIX V3 ---
            // --- END FIX ---
            const progress = parseFloat(card.dataset.progress || '0');
            return {
                Word: word,
                MainTranslations: mainText,
                ExtraTranslations: extraText,
                Tags: tags,
                EnglishSentences: englishSentences,
                GeorgianSentences: georgianSentences,
                Progress: progress + '%'
            };
        });
        const worksheet = XLSX.utils.json_to_sheet(cards);
        worksheet['!cols'] = [
            {wch: 20}, {wch: 30}, {wch: 30}, {wch: 25}, {wch: 80}, {wch: 80}, {wch: 10}
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Words");
        XLSX.writeFile(workbook, "english_words_with_progress.xlsx");
    };
    // ==== NEW "MY DICTIONARY" EXPORT FUNCTION (V3 - FINAL) ====
    document.getElementById('exportMyDictionaryBtn').onclick = () => {
        const cards = [...document.querySelectorAll('.card')].map(card => {
            // 1. ვიღებთ "სუფთა" მონაცემებს dataset-იდან
            const word = card.querySelector('.word').textContent.trim();
            const tagObjects = JSON.parse(card.dataset.tagObjects || '[]');
            // === NEW: თეგებს ვაერთებთ ";" -ით ===
            const tags = tagObjects.map(tagObj => tagObj.name).join('; '); //
            // 2. ვიღებთ თარგმანებს (ცალ-ცალკე)
            const mainText = card.querySelector('.translation').childNodes[0]?.textContent?.trim() || '';
            const extraText = card.querySelector('.translation .extra')?.textContent?.trim() || '';
            // 3. ვამრგვალებთ პროგრესს
            const progress = Math.round(parseFloat(card.dataset.progress || '0')) + '%'; //
            // 4. ვაწყვილებთ წინადადებებს (შენი მოთხოვნისამებრ)
            const englishSentences = JSON.parse(card.dataset.english || '[]');
            const georgianSentences = JSON.parse(card.dataset.georgian || '[]');
            const pairedExamples = [];
            const maxLen = Math.max(englishSentences.length, georgianSentences.length);
            for (let i = 0; i < maxLen; i++) {
                const en = englishSentences[i] || ''; // ვიღებთ ინგლისურს (ან ცარიელს)
                const ge = georgianSentences[i] || ''; // ვიღებთ ქართულს (ან ცარიელს)
                pairedExamples.push(`${en} — ${ge}`); // ვაწყვილებთ " — " ტირეთი
            }
            // ვაერთებთ ახალი ხაზით (\n), როგორც ექსელში (ALT+ENTER)
            const examplesString = pairedExamples.join('\n'); //
            // 5. ვაწყობთ ობიექტს ზუსტად შენი თანმიმდევრობით
            return {
                'Learned': progress,
                'Tags': tags,
                'Word': word,
                'Transcription': '', // === NEW: დავამატეთ ცარიელი სვეტი ===
                'Translation': mainText,
                'Additional Translation': extraText,
                'Examples': examplesString
            };
        });
        const worksheet = XLSX.utils.json_to_sheet(cards);
        // სვეტების სიგანეები (განახლებული)
        worksheet['!cols'] = [
            {wch: 10}, // Learned
            {wch: 25}, // Tags
            {wch: 20}, // Word
            {wch: 15}, // Transcription (NEW)
            {wch: 30}, // Translation
            {wch: 30}, // Additional Translation
            {wch: 80}  // Examples
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "My Dictionary");
        XLSX.writeFile(workbook, "my_dictionary_export.xlsx"); // ვიყენებთ .xlsx-ს
    };
    // ==== END NEW FUNCTION (V3 - FINAL) ====
    document.getElementById('importExcelInput').addEventListener('change', async function (e) { // <-- დავამატეთ ASYNC
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function (evt) { // <-- აქაც ASYNC
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet);
            if (json.length === 0) {
                alert("ცარიელი ფაილია");
                return;
            }
// ვაჩვენებთ "მიმდინარეობს..." შეტყობინებას
            showToast(`მიმდინარეობს ${json.length} სიტყვის იმპორტი...`, "info");
// ვიღებთ ბარათების ამჟამინდელ სიას, დუბლიკატების შესამოწმებლად
            const existingWords = new Set(
                [...document.querySelectorAll('.card .word')].map(el => el.textContent.trim().toLowerCase())
            );
            let addedCount = 0;
            let skippedCount = 0;
// ვიწყებთ იმპორტის ციკლს
            for (const entry of json) {
                const word = entry.Word?.trim();
                if (!word) continue;
// 1. ვამოწმებთ დუბლიკატს
                if (existingWords.has(word.toLowerCase())) {
                    skippedCount++;
                    continue; // გამოვტოვოთ, თუ ასეთი სიტყვა უკვე გვაქვს
                }
// 2. ვამზადებთ მონაცემებს RPC ფუნქციისთვის
                // 2. ვამზადებთ მონაცემებს RPC ფუნქციისთვის
                // --- FIX: იმპორტისას <br> გადაგვაქვს \n-ში ---
                // --- FIX V3: იმპორტისას ვშლით <br>-ზე, \n-ზე, ან |-ზე ---
                // Regex: / ?<br> ?|\r?\n|\|/gi
                // ეს დაშლის: "<br>", " <br> ", "\n" (ახალი ხაზი), ან "|"
                const english_sentences_input = (entry.EnglishSentences || '')
                    .split(/ ?<br> ?|\r?\n|\|/gi) // <-- მთავარი ფიქსი აქაა!
                    .map(s => s.trim().replace(/^\d+\.\s*/, '')) // <-- (ბონუსი: ვშლით ძველ ნუმერაციას, თუ არსებობს)
                    .filter(Boolean);
                const georgian_sentences_input = (entry.GeorgianSentences || '')
                    .split(/ ?<br> ?|\r?\n|\|/gi) // <-- მთავარი ფიქსი აქაა!
                    .map(s => s.trim().replace(/^\d+\.\s*/, '')) // <-- (ბონუსი: ვშლით ძველ ნუმერაციას, თუ არსებობს)
                    .filter(Boolean);
                const cardData = {
                    word_input: word,
                    main_translations_input: (entry.MainTranslations || '').split(',').map(t => t.trim()).filter(Boolean),
                    extra_translations_input: (entry.ExtraTranslations || '').split(',').map(t => t.trim()).filter(Boolean),
                    tag_names_input: (entry.Tags || '').split(',').map(t => t.trim()).filter(Boolean),
                    english_sentences_input: english_sentences_input,
                    georgian_sentences_input: georgian_sentences_input,
                    dictionary_id_input: currentDictionaryId
                };
                // --- END FIX V3 ---
// 3. ვიძახებთ ბაზის ფუნქციას
                const {error} = await supabaseClient.rpc('create_card_with_tags', cardData);
                if (error) {
                    showToast(`შეცდომა სიტყვაზე "${word}": ${error.message}`, "error");
// თუ ერთი ვერ დაემატა, დანარჩენები მაინც უნდა დაემატოს
                } else {
                    addedCount++;
                    existingWords.add(word.toLowerCase()); // დავამატოთ სიაში, რომ Excel-ის შიდა დუბლიკატებიც გაიფილტროს
                }
            }
// 4. დასრულების შემდეგ, სრულად განვაახლოთ UI ბაზიდან
            showToast(`იმპორტი დასრულდა: დაემატა ${addedCount}, გამოიტოვა ${skippedCount}`, "success");
            await loadDataFromSupabase(); // ეს ფუნქცია ყველაფერს თავიდან ჩატვირთავს და დახატავს
        };
        reader.readAsArrayBuffer(file);
    });
// Keyboard controls
    document.addEventListener('keydown', (e) => {
        const modalVisible = document.getElementById('cardPreviewModal').style.display === 'flex';
        if (!modalVisible) return;
        const cards = getVisibleCards();
        if (!cards.length) return;
        if (shuffleMode) {
            let randomIndex;
            do {
                randomIndex = Math.floor(Math.random() * cards.length);
            } while (randomIndex === currentCardIndex);
            currentCardIndex = randomIndex;
            loadCardIntoModal(cards[currentCardIndex]);
            return;
        }
        if (e.key === 'ArrowLeft') {
            if (currentCardIndex > 0) {
                currentCardIndex--;
                loadCardIntoModal(cards[currentCardIndex]);
            }
        } else if (e.key === 'ArrowRight') {
            if (currentCardIndex < cards.length - 1) {
                currentCardIndex++;
                loadCardIntoModal(cards[currentCardIndex]);
            }
        }
    });
// ==== 3d. აპლიკაციის გაშვება (Auth Check) ====
// ==== 3d. აპლიკაციის გაშვება (Auth Check) ====
// ==== 3d. აპლიკაციის გაშვება (Auth Check) ====
    // Use getSession() directly — more reliable than onAuthStateChange for initial load
    async function startApp() {
        console.log('[AWorded] startApp: checking session...');
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            console.log('[AWorded] startApp: session:', !!session);
            if (session) {
                currentUser = session.user;
                isAppInitialized = true;
                await initializeApp();
            } else {
                showAuthScreen();
            }
        } catch (e) {
            console.error('[AWorded] startApp failed:', e);
            showAuthScreen();
        }
    }

    // Listen for auth changes AFTER initial load (login, logout, token refresh)
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log('[AWorded] authStateChange:', event, 'session:', !!session);
        if (event === 'SIGNED_IN' && !isAppInitialized) {
            // User just logged in from the auth screen
            currentUser = session.user;
            isAppInitialized = true;
            await initializeApp();
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            isAppInitialized = false;
            showAuthScreen();
        }
    });

    // Start the app
    await startApp();
})();