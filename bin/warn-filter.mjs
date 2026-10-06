/**
 * Фильтр предупреждений Node для CLI-шимов (VL-102, env-фикс).
 *
 * Зачем: на Node ≥22 каждая загрузка CLI печатает в stderr DeprecationWarning
 * DEP0040 «The `punycode` module is deprecated» — цепочка grammy → node-fetch@2
 * → whatwg-url@5 → node:punycode (импорт-граф роутера грузит бот-код). Warning
 * сыпется в stderr при каждом запуске и ломает strict-сравнения вывода CLI
 * (тесты VL-12/VL-15/VL-9/VL-4/VL-69 и пользовательские скрипты, режущие
 * stderr). Подавляем ТОЛЬКО этот warning; все остальные предупреждения
 * печатаются как раньше (см. обработчик ниже).
 *
 * Модуль обязан импортироваться ПЕРВЫМ в shims: ESM-импорты выполняются
 * до тела модуля — фильтр встаёт в очередь 'warning'-слушателей до того,
 * как импорт-граф grammy успеет эмитить DEP0040.
 */

// Node по умолчанию печатает warnings своим слушателем — убираем его,
// чтобы перехватить вывод; не-punycode-предупреждения дублируем сами.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && String(warning.message).includes('punycode')) {
    return; // DEP0040 grammy/node-fetch — известный и безвредный для CLI
  }
  console.warn(warning);
});
