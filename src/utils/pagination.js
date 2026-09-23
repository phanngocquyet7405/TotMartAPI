/**
 * @param {Object} model
 * @param {Object} queryParams
 * @param {Object} filter
 * @param {Object} options
 * @returns {Object}
 */
const paginate = async (model, queryParams, filter = {}, options = {}) => {
  const page = Math.max(parseInt(queryParams.page, 10) || 1, 1);
  const limit = Math.min(parseInt(queryParams.limit, 10) || 10, 100);
  const skip = (page - 1) * limit;

  const { sort = { createdAt: -1 }, populate = null } = options;

  let query = model.find(filter).sort(sort).skip(skip).limit(limit);

  if (populate) {
    if (Array.isArray(populate)) {
      populate.forEach((p) => {
        query = query.populate(p);
      });
    } else {
      query = query.populate(populate);
    }
  }

  const [data, total] = await Promise.all([
    query.exec(),
    model.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

module.exports = { paginate };
