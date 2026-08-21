(function(){
  "use strict";

  var DAY_NAMES = ["Понедельник","Вторник","Среда","Четверг","Пятница","Суббота","Воскресенье"];
  var DAY_SHORT = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  var MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
  var MONTHS_FULL = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  var STORAGE_KEY = "weekly-planner-standalone-v1";

  var MOTIVATION = [
    {min:0, text:"Поехали — первый шаг сегодня"},
    {min:1, text:"Начало положено"},
    {min:40, text:"Хороший темп, продолжай"},
    {min:70, text:"Почти всё сделано"},
    {min:100, text:"День закрыт полностью 🎉"}
  ];

  function toKey(d){
    var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
    return y+"-"+m+"-"+dd;
  }
  function getMonday(date){
    var d=new Date(date); var day=d.getDay(); var diff = day===0? -6 : 1-day;
    d.setDate(d.getDate()+diff); d.setHours(0,0,0,0); return d;
  }
  function addDays(date,n){ var d=new Date(date); d.setDate(d.getDate()+n); return d; }
  function uid(){ return Math.random().toString(36).slice(2,10); }
  function weekdayIndex(date){ var day=date.getDay(); return day===0?6:day-1; }
  function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function motivationFor(pct,total){
    if (total===0) return "На этот день пока нет задач";
    var m = MOTIVATION[0];
    for (var i=0;i<MOTIVATION.length;i++) if (pct>=MOTIVATION[i].min) m=MOTIVATION[i];
    return m.text;
  }

  var state = {
    view: "week",
    weekOffset: 0,
    monthOffset: 0,
    selectedIndex: weekdayIndex(new Date()),
    recurring: [],
    oneOff: {},
    completions: {},
    modalOpen: false,
    modalVisible: false,
    modalDayIndex: weekdayIndex(new Date()),
    draftText: "",
    draftTime: "",
    draftRepeat: false
  };

  function loadState(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        state.recurring = parsed.recurring || [];
        state.oneOff = parsed.oneOff || {};
        state.completions = parsed.completions || {};
      }
    } catch(e){ console.error("Load failed", e); }
  }
  function saveState(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        recurring: state.recurring, oneOff: state.oneOff, completions: state.completions
      }));
    } catch(e){ console.error("Save failed", e); }
  }

  function tasksForDay(date, weekday){
    var key = toKey(date);
    var rec = state.recurring.filter(function(t){ return t.weekday===weekday; })
      .map(function(t){ return Object.assign({}, t, {key:key, recurring:true}); });
    var one = (state.oneOff[key]||[]).map(function(t){ return Object.assign({}, t, {key:key, recurring:false}); });
    var combined = rec.concat(one);
    combined.sort(function(a,b){
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });
    return combined;
  }
  function dayStats(date, weekday){
    var key = toKey(date);
    var tasks = tasksForDay(date, weekday);
    var done = tasks.filter(function(t){ return !!state.completions[key+"::"+t.id]; }).length;
    return { total: tasks.length, done: done, pct: tasks.length? Math.round(done/tasks.length*100):0 };
  }

  function computeStreak(){
    var count=0, today=new Date();
    for (var i=0;i<60;i++){
      var d=addDays(today,-i); var wd=weekdayIndex(d);
      var s=dayStats(d,wd);
      if (s.total===0){ if(i===0) continue; break; }
      if (s.done===s.total) count++; else break;
    }
    return count;
  }

  function stitchHtml(pct, total){
    var bars="";
    for (var i=0;i<24;i++){
      var filled = total>0 && i < Math.round(pct/100*24);
      bars += '<div class="'+(filled?"filled":"")+'"></div>';
    }
    return '<div class="stitch">'+bars+'</div>';
  }

  window.actions = {
    setView: function(v){ state.view=v; render(); },
    prevWeek: function(){ state.weekOffset--; render(); },
    nextWeek: function(){ state.weekOffset++; render(); },
    thisWeek: function(){ state.weekOffset=0; state.selectedIndex=weekdayIndex(new Date()); render(); },
    prevMonth: function(){ state.monthOffset--; render(); },
    nextMonth: function(){ state.monthOffset++; render(); },
    thisMonth: function(){ state.monthOffset=0; render(); },
    selectDay: function(i){ state.selectedIndex=i; render(); },
    toggleDone: function(dateKey,id){
      var k = dateKey+"::"+id;
      if (state.completions[k]) delete state.completions[k]; else state.completions[k]=true;
      saveState(); render();
    },
    removeTask: function(id, isRecurring, dateKey){
      if (isRecurring){
        state.recurring = state.recurring.filter(function(t){ return t.id!==id; });
        Object.keys(state.completions).forEach(function(k){ if (k.endsWith("::"+id)) delete state.completions[k]; });
      } else {
        state.oneOff[dateKey] = (state.oneOff[dateKey]||[]).filter(function(t){ return t.id!==id; });
        delete state.completions[dateKey+"::"+id];
      }
      saveState(); render();
    },
    jumpToDate: function(dateStr){
      var d = new Date(dateStr+"T00:00:00");
      var today = new Date();
      var diffWeeks = Math.round((getMonday(d)-getMonday(today))/(7*86400000));
      state.weekOffset = diffWeeks;
      state.selectedIndex = weekdayIndex(d);
      state.view = "week";
      render();
    },
    openModal: function(){
      state.modalDayIndex = state.selectedIndex;
      state.draftText=""; state.draftTime=""; state.draftRepeat=false;
      state.modalOpen = true; state.modalVisible=false;
      render();
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        state.modalVisible = true; render();
        var el = document.getElementById("draftTextInput");
        if (el) setTimeout(function(){ el.focus(); }, 50);
      }); });
    },
    closeModal: function(){
      state.modalVisible = false; render();
      setTimeout(function(){ state.modalOpen=false; render(); }, 200);
    },
    setModalDay: function(i){ state.modalDayIndex=i; render(); },
    setDraftText: function(v){ state.draftText=v; syncSubmitButton(); },
    setDraftTime: function(v){ state.draftTime=v; },
    toggleRepeat: function(){ state.draftRepeat = !state.draftRepeat; render(); },
    submitModal: function(){
      var text = state.draftText.trim();
      if (!text) return;
      var monday = getMonday(addDays(new Date(), state.weekOffset*7));
      var weekDates = Array.from({length:7}, function(_,i){ return addDays(monday,i); });
      var targetDate = weekDates[state.modalDayIndex];
      var targetKey = toKey(targetDate);
      var time = state.draftTime || null;
      if (state.draftRepeat){
        state.recurring.push({id:uid(), text:text, weekday: state.modalDayIndex, time:time});
      } else {
        if (!state.oneOff[targetKey]) state.oneOff[targetKey]=[];
        state.oneOff[targetKey].push({id:uid(), text:text, time:time});
      }
      state.selectedIndex = state.modalDayIndex;
      saveState();
      window.actions.closeModal();
    },
    handleTextKey: function(e){ if (e.key==="Enter") window.actions.submitModal(); }
  };

  function syncSubmitButton(){
    var btn = document.getElementById("submitBtn");
    if (!btn) return;
    var ready = state.draftText.trim().length>0;
    btn.className = "submit-btn" + (ready? " ready":"");
  }

  function render(){
    var today = new Date();
    var todayKey = toKey(today);
    var monday = getMonday(addDays(today, state.weekOffset*7));
    var weekDates = Array.from({length:7}, function(_,i){ return addDays(monday,i); });

    var weekAgg = (function(){
      var total=0, done=0;
      weekDates.forEach(function(d,i){ var s=dayStats(d,i); total+=s.total; done+=s.done; });
      return {total:total, done:done, pct: total? Math.round(done/total*100):0};
    })();

    var selectedDate = weekDates[state.selectedIndex];
    var selectedKey = toKey(selectedDate);
    var selectedTasks = tasksForDay(selectedDate, state.selectedIndex);
    var selectedStats = dayStats(selectedDate, state.selectedIndex);
    var motivation = motivationFor(selectedStats.pct, selectedStats.total);
    var streak = computeStreak();
    var rangeLabel = monday.getDate()+" "+MONTHS[monday.getMonth()]+" – "+weekDates[6].getDate()+" "+MONTHS[weekDates[6].getMonth()];

    var html = "";
    html += '<div class="header">';
    html += '  <div class="row"><span class="title serif">Планировщик</span></div>';
    html += '  <div class="row" style="gap:8px;">';
    if (streak>0) html += '<div class="streak-badge">🔥 '+streak+'</div>';
    html += '    <button class="fab" onclick="actions.openModal()" aria-label="Добавить задачу">'+
            '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'+
            '</button>';
    html += '  </div>';
    html += '</div>';

    html += '<div class="switcher">';
    html += '  <button class="'+(state.view==="week"?"active":"")+'" onclick="actions.setView(\'week\')">Неделя</button>';
    html += '  <button class="'+(state.view==="month"?"active":"")+'" onclick="actions.setView(\'month\')">Месяц</button>';
    html += '</div>';

    if (state.view==="week"){
      html += '<div class="nav-row">';
      html += '  <button class="nav-btn" onclick="actions.prevWeek()" aria-label="Предыдущая неделя">'+chevron("left")+'</button>';
      html += '  <div class="center-col"><span class="range-label">'+rangeLabel+'</span>';
      if (state.weekOffset!==0) html += '<button class="jump-link" onclick="actions.thisWeek()">к этой неделе</button>';
      html += '  </div>';
      html += '  <button class="nav-btn" onclick="actions.nextWeek()" aria-label="Следующая неделя">'+chevron("right")+'</button>';
      html += '</div>';

      html += '<div class="card report-card">';
      html += '  <div style="flex:1">'+stitchHtml(weekAgg.pct, weekAgg.total)+
              '<div class="report-sub">'+(weekAgg.total===0? "Пока нет задач на неделю" : "За неделю выполнено "+weekAgg.done+" из "+weekAgg.total)+'</div></div>';
      html += '  <div class="report-pct serif">'+weekAgg.pct+'%</div>';
      html += '</div>';

      html += '<div class="day-tabs">';
      weekDates.forEach(function(date,i){
        var key = toKey(date);
        var isToday = key===todayKey;
        var isSelected = i===state.selectedIndex;
        var s = dayStats(date,i);
        html += '<button class="day-tab'+(isSelected?" selected":"")+(isToday&&!isSelected?" today":"")+'" onclick="actions.selectDay('+i+')">';
        html += '<span class="dlabel">'+DAY_SHORT[i]+'</span>';
        html += '<span class="dnum">'+date.getDate()+'</span>';
        html += '<div class="dbar"><div class="dbar-fill" style="width:'+s.pct+'%"></div></div>';
        html += '</button>';
      });
      html += '</div>';

      html += '<div class="card day-panel">';
      html += '  <div class="day-panel-head"><span>'+DAY_NAMES[state.selectedIndex]+'</span><span>'+selectedStats.pct+'%</span></div>';
      html += '  <div class="motivation">'+motivation+'</div>';
      if (selectedTasks.length===0){
        html += '<div class="empty-hint">Пока пусто. Нажми «+» вверху, чтобы добавить задачу.</div>';
      } else {
        selectedTasks.forEach(function(t){
          var done = !!state.completions[selectedKey+"::"+t.id];
          html += '<div class="task-row">';
          html += '  <button class="checkbox'+(done?" done":"")+'" onclick="actions.toggleDone(\''+selectedKey+'\',\''+t.id+'\')" aria-label="Отметить">'+
                  (done? '<svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '')+
                  '</button>';
          if (t.time) html += '<span class="task-time'+(done?" done":"")+'">'+t.time+'</span>';
          html += '  <span class="task-text'+(done?" done":"")+'">'+escapeHtml(t.text)+'</span>';
          if (t.recurring) html += '<span class="repeat-icon">'+repeatIcon()+'</span>';
          html += '  <button class="del-btn" onclick="actions.removeTask(\''+t.id+'\','+(t.recurring?"true":"false")+',\''+t.key+'\')" aria-label="Удалить">'+closeIconSmall()+'</button>';
          html += '</div>';
        });
      }
      html += '</div>';

    } else {
      var monthBase = new Date(); monthBase.setDate(1); monthBase.setMonth(monthBase.getMonth()+state.monthOffset);
      var mYear = monthBase.getFullYear(), mMonth = monthBase.getMonth();
      var total = daysInMonth(mYear,mMonth);
      var monthDays = Array.from({length: total}, function(_,i){ return new Date(mYear,mMonth,i+1); });
      var leadingBlanks = weekdayIndex(monthDays[0]);
      var monthAgg = (function(){
        var t=0,d=0;
        monthDays.forEach(function(dt){ var s=dayStats(dt, weekdayIndex(dt)); t+=s.total; d+=s.done; });
        return {total:t, done:d, pct: t? Math.round(d/t*100):0};
      })();

      html += '<div class="nav-row">';
      html += '  <button class="nav-btn" onclick="actions.prevMonth()" aria-label="Предыдущий месяц">'+chevron("left")+'</button>';
      html += '  <div class="center-col"><span class="serif" style="font-weight:700;font-size:0.95rem;">'+MONTHS_FULL[mMonth]+' '+mYear+'</span>';
      if (state.monthOffset!==0) html += '<button class="jump-link" onclick="actions.thisMonth()">к этому месяцу</button>';
      html += '  </div>';
      html += '  <button class="nav-btn" onclick="actions.nextMonth()" aria-label="Следующий месяц">'+chevron("right")+'</button>';
      html += '</div>';

      html += '<div class="card report-card">';
      html += '  <div style="flex:1">'+stitchHtml(monthAgg.pct, monthAgg.total)+
              '<div class="report-sub">'+(monthAgg.total===0? "Пока нет задач за месяц" : "За месяц выполнено "+monthAgg.done+" из "+monthAgg.total)+'</div></div>';
      html += '  <div class="report-pct serif">'+monthAgg.pct+'%</div>';
      html += '</div>';

      html += '<div class="card" style="padding:12px;">';
      html += '  <div class="month-grid-head">'+DAY_SHORT.map(function(d){return '<span>'+d+'</span>';}).join("")+'</div>';
      html += '  <div class="month-grid">';
      for (var b=0;b<leadingBlanks;b++) html += '<div></div>';
      monthDays.forEach(function(d){
        var s = dayStats(d, weekdayIndex(d));
        var isToday = toKey(d)===todayKey;
        var alpha = s.total===0? 0 : 0.16 + (s.pct/100)*0.68;
        var bg = s.total===0? "var(--surface-soft)" : "rgba(76,122,93,"+alpha+")";
        var color = s.pct>55? "#FFFFFF" : "var(--ink-soft)";
        html += '<button class="month-cell'+(isToday?" today":"")+'" style="background:'+bg+'" onclick="actions.jumpToDate(\''+toKey(d)+'\')">'+
                '<span style="color:'+color+'">'+d.getDate()+'</span></button>';
      });
      html += '  </div>';
      html += '</div>';
      html += '<div class="month-hint">Цвет ячейки — % выполнения задач в этот день. Нажми на день, чтобы открыть его в неделе.</div>';
    }

    if (state.modalOpen){
      var wd = weekDates;
      html += '<div class="overlay'+(state.modalVisible?" visible":"")+'" onclick="if(event.target===this) actions.closeModal()">';
      html += '  <div class="sheet'+(state.modalVisible?" visible":"")+'">';
      html += '    <div class="sheet-head"><span class="serif">Новая задача</span><button class="sheet-close" onclick="actions.closeModal()" aria-label="Закрыть">'+closeIcon()+'</button></div>';
      html += '    <div class="day-picker">';
      wd.forEach(function(d,i){
        var active = i===state.modalDayIndex;
        html += '<button class="day-pick'+(active?" active":"")+'" onclick="actions.setModalDay('+i+')"><span>'+DAY_SHORT[i]+'</span><span>'+d.getDate()+'</span></button>';
      });
      html += '    </div>';
      html += '    <input id="draftTextInput" class="text-input" type="text" placeholder="Что нужно сделать?" value="'+escapeHtml(state.draftText)+'" oninput="actions.setDraftText(this.value)" onkeydown="actions.handleTextKey(event)" />';
      html += '    <div class="field-row">';
      html += '      <div class="time-wrap">'+clockIcon()+'<input class="time-input" type="time" value="'+state.draftTime+'" oninput="actions.setDraftTime(this.value)" /></div>';
      html += '      <button class="repeat-toggle'+(state.draftRepeat?" active":"")+'" onclick="actions.toggleRepeat()">'+repeatIcon()+'<span>Повтор</span></button>';
      html += '    </div>';
      html += '    <button id="submitBtn" class="submit-btn'+(state.draftText.trim()?" ready":"")+'" onclick="actions.submitModal()">'+plusIcon()+'<span>Добавить</span></button>';
      html += '  </div>';
      html += '</div>';
    }

    document.getElementById("app").innerHTML = html;
  }

  function chevron(dir){
    var d = dir==="left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6";
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'+d+'"/></svg>';
  }
  function repeatIcon(){
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>';
  }
  function closeIconSmall(){
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  function closeIcon(){
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  function clockIcon(){
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  }
  function plusIcon(){
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  }

  loadState();
  render();
})();