// 运行：node cloudfunctions/rateUser/validate.test.js
const assert = require('assert');
const { validateRating } = require('./validate');

assert.deepStrictEqual(validateRating({ stars: 5, tags: ['守时', '热心'] }), { stars: 5, tags: ['守时', '热心'] });
assert.deepStrictEqual(validateRating({ stars: '4' }), { stars: 4, tags: [] });
assert.ok(validateRating({ stars: 0 }).error);
assert.ok(validateRating({ stars: 6 }).error);
assert.ok(validateRating({ stars: 4.5 }).error);
assert.ok(validateRating(null).error);
// 不认识的标签和重复标签被去掉
assert.deepStrictEqual(validateRating({ stars: 3, tags: ['守时', '守时', '<script>'] }).tags, ['守时']);

console.log('rating validation tests passed');
