const
  _ = require('lodash'),
  moment = require('moment'),
  common = require('../common/basic')

class ApiDialect {
  constructor (req, res) {
    this.req = req
    this.res = res
    this.args = null
    this.sent = false
    this.result = {}
  }

  /**
   * 从 req 中拿到所有的参数,并进行预处理, 返回标准格式的 args
   * args 参数要求必须是是 Arg的实例
   * Arg {
   *    name: 字段名称,
   *    required: 该字段是否可以为空, 默认为 false,
   *    type: [number|boolean|string|integer|array|array|json] 根据 type 的值转换响应的类型,
   *    default: 如果字段对应的值为空, 则赋默认值,
   *    dateFormat: 日期格式规范化
   *    strict: 严格模式, 如果 strict 为 true, 那么 字段对应的值必须与 type 类型保持一致
   *  }
   *
   * @param {array} args, 标准化处理需要的参数
   *
   * @return {boolean}
   */
  setArgs (args) {

    /* ------------------------ 参数判断 ---------------------------------- */
    if (!_.isArray(args)) {
      throw new Error('参数类型必须是Array!')
    }
    if (!args.every(arg => arg.constructor.name === 'Arg')) {
      throw new Error('参数中每个字段都必须是 Arg 的实例!')
    }

    let params = Object.assign({}, this.req.params, this.req.query, this.req.body)

    /* ------------------------ 开始处理参数 ---------------------------------- */
    let result = true
    let stdArgs = {} // 标准参数容器

    let typeSet = {
      number: _.toNumber,
      boolean: i => _.isBoolean(i) ? i : i === 'true',
      string: _.toString,
      integer: _.toSafeInteger,
      array: common.toArray,
      json: JSON.parse
    }

    args.forEach(arg => {
      if (this.sent) {
        return
      }

      let field = arg.name

      Object.keys(params).forEach(k => {
        if (k === field || k.match(new RegExp(`^${field}_`))) {
          field = k
        }
      })

      let v = params[field]

      stdArgs[field] = v


      if (arg.dft && common.isEmpty(v)) {
        stdArgs[field] = arg.dft
      }

      if (arg.required && common.isEmpty(v)) {
        this.res.json({
          msg: `参数 ${field} 不能为空`,
          code: 1,
          status: 'failed'
        })
        this.sent = true

        result = false

        return
      }

      if (arg.type && _.has(typeSet, arg.type) && !common.isEmpty(v)) {
        if (arg.strict && !_[`is${_.upperFirst(arg.type)}`](v)) {
          let msg

          if (_.isString(arg.strict)) {
            msg = arg.strict
          } else if (_.isNumber(arg.strict)) {
            msg = errors[arg.strict]
          } else {
            msg = `参数 ${field} 的类型必须是 ${arg.type}`
          }

          this.res.json({
            msg,
            code: 1,
            status: 'failed'
          })

          this.sent = true
          result = false

          return
        }

        stdArgs[field] = typeSet[arg.type](v)
      }

      if (arg.dateFormat && !common.isEmpty(v)) {
        stdArgs[field] = moment(v).format(arg.dateFormat)
      }

      if (arg.range && arg.range.length !== 0 && !arg.range.includes(v)) {
        let include = true

        if (_.isString(v)) {
          if (v.includes(',')) {
            v.split(',').forEach(i => {
              !arg.range.includes(i) ? include = false : undefined
            })
          } else if (arg.range.includes(v)) {
            include = false
          }
        } else if (_.isArray(v)) {
          v.forEach(i => {
            !arg.range.includes(i) ? include = false : undefined
          })
        }

        if (!include) {
          this.res.json({
            msg: `参数 ${field} 的值必须是以下之一: ${arg.range.join(',')}`,
            code: 0,
            status: 'failed'
          })
          this.sent = true
          result = false
        }
      }

    })

    this.args = common.clear(stdArgs)

    return result
  } // 思考题, 如果是批量创建, 该怎么办?

  /**
   * 对查询出来的数据进行处理, 并发送给前端
   * 可以传入参数 opts, 对待发送的原始数据进行加工处理
   * opts = {
   *   type: json|render|ejs@default=json, 选择响应类型
   *   view: string, 模板名称 如果 type 为 render 的时候, view 必须存在
   *   blank: boolean@default=true, 是否对数据进行去空处理
   *   dateFormat: ['YYYY-MM-DD',field1, field2], 对date 类型数据进行格式化
   *   remove: [field1,field2], 删除字段
   * }
   *
   *
   * @param {object} opts 数据处理参数
   * @return {Promise}
   */
  send (opts = {
    type: 'json',
    blank: process.env.NODE_ENV === 'production',
    dateFormat: ['YYYY-MM-DD HH:mm', 'createdAt', 'updatedAt'],
    needWrap: false
  }) {
    let self = this
    let data = this.result

    if (!opts.type) {
      opts.type = 'json'
    }
    if (opts.type === 'render' && !opts.view) {
      throw new Error('opts 中的 view 参数不能为空!')
    }
    if (!opts.blank) {
      opts.blank = process.env.NODE_ENV === 'production'
    }
    if (!opts.dateFormat) {
      opts.dateFormat = ['YYYY-MM-DD HH:mm', 'createdAt', 'updatedAt']
    }

    if (!opts.hasOwnProperty('needWrap')) {
      opts.needWrap = true
    }

    /**
     * 辅助函数, 用于发送响应
     *
     * @param {object} obj 待处理的目标
     * @return {boolean}
     */
    function _res (obj) {
      if (opts.needWrap) {
        if (_.isObject(obj) && Object.keys(obj).length <= 2 && (_.has(obj, 'rows') || _.has(obj, 'count'))) {
          data = {
            objs: obj.rows,
            count: obj.count
          }
        } else {
          data = _.isArray(obj) ? {objs: obj} : {obj}
        }
      } else {
        data = obj
      }


      if (opts.type === 'render') {
        self.res[opts.type](opts.view, data)
      }

      if (opts.type === 'json') {
        data.status = 'success'
        self.res[opts.type](data)
      }

      if (opts.type === 'send') {
        self.res[opts.type](obj)
      }

      self.sent = true

      return self.sent
    }
    data = JSON.parse(JSON.stringify(data))

    if (opts.blank && _.isEmpty(opts.remove)) {
      data = common.clear(data, [], false)
    }
    if (opts.blank && !_.isEmpty(opts.remove)) {
      data = common.clear(data, opts.remove, false)
    }
    if (!_.isEmpty(opts.remove) && !opts.blank) {
      data = common.remove(data, opts.remove)
    }

    if (data && opts.dateFormat) {
      let format = 0
      let fieldIndex = 1

      data = common.dateFormat(data, opts.dateFormat[format], opts.dateFormat.slice(fieldIndex))
    }

    if (!this.sent) {
      _res(data)
    }

    return Promise.resolve(data)
  }

  /**
   * 错误结果处理, 以 json 格式, 将错误信息发送给前端
   *
   * @param {error} err 错误代码
   *
   * @return {object}
   */
  error (err) {
    console.log(err)
    let code, msg

    _.isObject(err) && err.message ? msg = err.message : msg = err

    let codeReg = /-(\d+)$/
    let match = msg.match(codeReg)

    if (match) {
      code = match[1]
      msg = msg.replace(codeReg, '')
    } else {
      code = 0
    }

    // 判断是否为 sequelize 的报错
    if (err.sql) {

      // 判断是否为字段重复的错误
      if (err.message === 'Validation error') {
        if (err.errors[0].type === 'unique violation') {
          code = 'Field Repetition'
          msg = `${err.errors[0].message} -- ${err.errors[0].value}`
        }

        else {
          code = 'Sequelize Error'
          msg = err.message
        }
      }

      // 判断是否为外键约束的错误（外键没有对应的数据）
      else if (err.name === 'SequelizeForeignKeyConstraintError') {
        code = '外键约束错误'
        msg = `该字段没有对应数据 --- ${err.index}`
      }

      // 其余
      else {
        code = 'Sequelize Error'
        msg = err.message
      }
    }

    return this.res.json({
      code,
      msg,
      status: 'failed'
    })
  }

  /**
   * 将数据库查询数据传入api 中
   *
   * @param {object} obj, 待发送的数据
   *
   * @return {object}
   */
  setResponse (obj) {
    this.result = obj

    return this
  }
}

module.exports = ApiDialect
