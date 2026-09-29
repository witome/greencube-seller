<template>
  <view class="page">
    <!-- 用户协议 -->
    <block v-if="type === 'user'">
      <view class="h1">辉崧鲜配用户协议</view>
      <view class="update">更新日期：2026年9月29日</view>

      <view class="h2">一、协议的确认与接受</view>
      <view class="p">本协议是您与保定辉崧科技有限公司（以下简称“我们”）就使用“辉崧鲜配”小程序服务所订立的协议。您注册、登录或使用本小程序服务，即视为您已阅读、理解并同意接受本协议的全部内容。</view>

      <view class="h2">二、服务内容</view>
      <view class="p">1. 本小程序面向餐饮采购客户提供生鲜食材信息浏览、下单、订单状态查询、收货确认等服务，并提供语音智能下单等便捷功能。</view>
      <view class="p">2. 小程序内同时设置供货协作与配送协作账号，供与我们合作的供货方、配送方进行供货管理、接单与交付配送使用，此类账号不对社会公众开放注册，由平台审核后开通。</view>
      <view class="p">3. 我们展示的商品价格、规格、可供数量等信息以您实际下单时页面展示为准；因生鲜商品特性，实际交付的品类、数量以双方确认及配送交付为准。</view>

      <view class="h2">三、用户注册与信息规范</view>
      <view class="p">1. 您应保证注册及使用过程中提交的信息真实、准确、完整，信息发生变化时应及时更新。</view>
      <view class="p">2. 您不得利用本小程序从事任何违法违规活动，不得干扰平台正常运营，不得侵犯他人合法权益。</view>

      <view class="h2">四、订单与交付</view>
      <view class="p">1. 您通过本小程序提交订单后，可在订单页面查看备货、配送等状态。</view>
      <view class="p">2. 双方可按照页面支持的方式完成货款结算。请您在收货时核对商品种类、数量及外观，如有异常可通过售后入口或客服渠道反馈。</view>

      <view class="h2">五、协议的变更与终止</view>
      <view class="p">我们可能根据法律法规变化及业务调整对本协议进行修订，修订后的协议将在本页面公示。若您不同意修订内容，可停止使用本小程序；继续使用即视为接受修订后的协议。</view>

      <view class="h2">六、法律适用与争议解决</view>
      <view class="p">本协议的订立、执行与解释均适用中华人民共和国法律。因本协议或使用本小程序产生的争议，双方应友好协商解决；协商不成的，可向我们所在地有管辖权的人民法院提起诉讼。</view>

      <view class="h2">七、联系我们</view>
      <view class="p">如对本协议有任何疑问，可通过小程序「我的」页面客服入口与我们联系。开发者：保定辉崧科技有限公司。</view>
    </block>

    <!-- 隐私政策 -->
    <block v-else>
      <view class="h1">辉崧鲜配隐私政策</view>
      <view class="update">更新日期：2026年9月29日</view>
      <view class="p">本政策是“辉崧鲜配”小程序开发者保定辉崧科技有限公司为处理您的个人信息而制定。我们仅处理实现小程序功能所必要的信息。</view>

      <view class="h2">一、我们收集和使用的信息</view>
      <view class="p">1. 微信昵称、头像：用于在小程序中展示您的个人资料。</view>
      <view class="p">2. 麦克风：在您明示同意后访问，用于语音说出采买清单，自动识别生成订单草稿，方便快速下单。</view>
      <view class="p">3. 相册：在您主动选择图片时使用，用于上传收货凭证、收款凭证、商品照片等图片。</view>
      <view class="p">4. 注册信息：您注册时填写的名称、联系人、手机号、地址等信息，用于开通服务、订单配送及与您联系。</view>

      <view class="h2">二、第三方插件信息</view>
      <view class="p">为实现语音识别功能，我们接入了“微信同声传译”插件，其运营主体为深圳市腾讯计算机系统有限公司，用于将您的语音转为文字以支持智能下单。该插件的个人信息处理规则以其官方公示为准。</view>

      <view class="h2">三、信息的存储与保护</view>
      <view class="p">除法律法规另有规定外，我们对您信息的保存期限为实现处理目的所必要的最短时间。我们采取合理的安全措施保护您的个人信息，防止信息遭到未经授权的访问、泄露或丢失。</view>

      <view class="h2">四、您的权利</view>
      <view class="p">您可以通过小程序「我的」页面客服入口与我们联系，依法行使查阅、复制、更正、删除个人信息以及注销账号等权利。我们在受理您的申请后，将按照法律法规规定的时限完成核查和处理。</view>

      <view class="h2">五、未成年人保护</view>
      <view class="p">若您是14周岁以下的未成年人，需要和监护人共同仔细阅读本政策，并在征得监护人明示同意后继续使用本小程序。</view>

      <view class="h2">六、政策的更新</view>
      <view class="p">本政策可能适时修订，修订后的内容将在本页面公示。如我们使用您的信息超出本政策载明的目的或范围，将通过小程序弹窗等方式再次告知并征得您的明示同意。</view>

      <view class="h2">七、联系我们</view>
      <view class="p">如对本政策有任何疑问，可通过小程序「我的」页面客服入口与我们联系。开发者：保定辉崧科技有限公司。</view>
    </block>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const type = ref('user')
onLoad((q) => {
  type.value = q && q.type === 'privacy' ? 'privacy' : 'user'
  uni.setNavigationBarTitle({ title: type.value === 'privacy' ? '隐私政策' : '用户协议' })
})
</script>

<style lang="scss" scoped>
.page { padding: 16px; }
.h1 { font-size: 19px; font-weight: 700; color: #1f2329; margin-bottom: 6px; }
.update { font-size: 12px; color: #8a9099; margin-bottom: 14px; }
.h2 { font-size: 15px; font-weight: 600; color: #1f2329; margin: 16px 0 8px; }
.p { font-size: 14px; color: #4e555f; line-height: 1.7; margin-bottom: 8px; }
</style>
