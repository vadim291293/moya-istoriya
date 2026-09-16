import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Ellipse,
  Path
} from 'react-native-svg';

function BabyBookIllustration() {
  return (
    <View style={styles.picture}>
      <Svg width="330" height="330" viewBox="0 0 330 330">

        {/* декоративное облако */}
        <Path
          d="M48 88
             C35 88 29 76 36 66
             C40 57 50 54 59 57
             C62 44 75 37 87 43
             C94 33 111 34 117 47
             C130 46 139 55 139 66
             C139 78 128 88 116 88 Z"
          fill="#FFFDF9"
        />

        {/* второе облако */}
        <Path
          d="M216 75
             C207 67 211 54 222 51
             C226 39 241 36 250 45
             C260 39 275 45 276 58
             C289 59 295 70 290 80
             C286 88 278 91 268 91
             L226 91
             C221 87 218 82 216 75 Z"
          fill="#FFFDF9"
        />

        {/* звёздочки */}
        <Path
          d="M48 126 L53 138 L66 143 L53 148 L48 161 L43 148 L30 143 L43 138 Z"
          fill="#E9B8B0"
        />

        <Path
          d="M282 126 L286 136 L297 140 L286 144 L282 155 L278 144 L267 140 L278 136 Z"
          fill="#E9B8B0"
        />

        {/* мягкая подложка */}
        <Ellipse
          cx="165"
          cy="288"
          rx="116"
          ry="25"
          fill="#EADBD5"
        />

        {/* одеяльце */}
        <Path
          d="M82 227
             Q165 190 248 227
             L239 280
             Q165 304 91 280 Z"
          fill="#F4D8D0"
        />

        {/* тело */}
        <Path
          d="M108 205
             Q165 183 222 205
             L230 270
             Q165 289 100 270 Z"
          fill="#FFF9F3"
        />

        {/* воротник */}
        <Path
          d="M132 204 Q165 225 198 204"
          stroke="#E9C6BD"
          strokeWidth="5"
          fill="none"
        />

        {/* левая ручка */}
        <Circle
          cx="101"
          cy="231"
          r="22"
          fill="#F6C4A7"
        />

        {/* правая ручка */}
        <Circle
          cx="229"
          cy="231"
          r="22"
          fill="#F6C4A7"
        />

        {/* голова */}
        <Circle
          cx="165"
          cy="137"
          r="72"
          fill="#F7C5A7"
        />

        {/* уши */}
        <Circle
          cx="95"
          cy="147"
          r="17"
          fill="#F2B99C"
        />

        <Circle
          cx="235"
          cy="147"
          r="17"
          fill="#F2B99C"
        />

        {/* чепчик */}
        <Path
          d="M98 129
             Q101 61 165 53
             Q229 61 232 129
             Q205 106 165 107
             Q125 106 98 129 Z"
          fill="#FFF1E7"
        />

        {/* кант чепчика */}
        <Path
          d="M105 114 Q165 91 225 114"
          stroke="#E6BEB3"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />

        {/* маленький бантик */}
        <Path
          d="M165 70
             C151 56 136 66 143 78
             C149 88 159 82 165 76
             C171 82 181 88 187 78
             C194 66 179 56 165 70 Z"
          fill="#E8A4A6"
        />

        {/* волосы */}
        <Path
          d="M122 82 Q145 61 165 67 Q185 61 208 82"
          stroke="#805643"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
        />

        {/* глаза */}
        <Ellipse
          cx="139"
          cy="142"
          rx="9"
          ry="13"
          fill="#51413D"
        />

        <Ellipse
          cx="191"
          cy="142"
          rx="9"
          ry="13"
          fill="#51413D"
        />

        {/* блики */}
        <Circle cx="142" cy="138" r="3" fill="#FFFFFF" />
        <Circle cx="194" cy="138" r="3" fill="#FFFFFF" />

        {/* щёчки */}
        <Ellipse
          cx="119"
          cy="163"
          rx="15"
          ry="8"
          fill="#EE9F9F"
          opacity={0.55}
        />

        <Ellipse
          cx="211"
          cy="163"
          rx="15"
          ry="8"
          fill="#EE9F9F"
          opacity={0.55}
        />

        {/* нос */}
        <Path
          d="M162 153 Q165 158 168 153"
          stroke="#D98C7C"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />

        {/* улыбка */}
        <Path
          d="M148 168 Q165 183 182 168"
          stroke="#B96870"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />

        {/* сердечко на одежде */}
        <Path
          d="M165 235
             C153 218 131 226 134 242
             C137 256 165 269 165 269
             C165 269 193 256 196 242
             C199 226 177 218 165 235 Z"
          fill="#E98991"
        />

        {/* маленькие цветочки */}
        <Circle cx="63" cy="213" r="4" fill="#E5B1A8" />
        <Circle cx="270" cy="221" r="4" fill="#E5B1A8" />

        {/* маленькие точки */}
        <Circle cx="72" cy="185" r="3" fill="#D9A39B" />
        <Circle cx="259" cy="182" r="3" fill="#D9A39B" />
      </Svg>
    </View>
  );
}

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.page}>

        {/* верхняя часть */}
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoHeart}>♥</Text>
          </View>

          <Text style={styles.brand}>
            Моя история
          </Text>

          <Text style={styles.subtitle}>
            Книга детства, которую вы создаёте вместе
          </Text>
        </View>

        {/* декоративная карточка-книга */}
        <View style={styles.bookCard}>
          <View style={styles.cornerTopLeft} />
          <View style={styles.cornerTopRight} />

          <BabyBookIllustration />

          <Text style={styles.handwritten}>
            Моя история
          </Text>

          <Text style={styles.bookCaption}>
            Здесь начинается самое главное
          </Text>
        </View>

        {/* текст */}
        <View style={styles.message}>
          <Text style={styles.title}>
            Сохраним
          </Text>

          <Text style={styles.titleAccent}>
            каждый момент
          </Text>

          <Text style={styles.description}>
            Первые улыбки, первые шаги,
            любимые праздники и семейные
            истории — всё в одной книге.
          </Text>
        </View>

        {/* кнопки */}
        <View style={styles.buttons}>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryText}>
              Создать аккаунт
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryText}>
              Войти
            </Text>
          </Pressable>

        </View>

        <Text style={styles.footer}>
          ♥ Ваша семья · ваши воспоминания · ваша история
        </Text>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F2EC',
  },

  page: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 22,
  },

  header: {
    alignItems: 'center',
    paddingTop: 5,
  },

  logo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F2D4CE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },

  logoHeart: {
    fontSize: 20,
    color: '#C76E78',
  },

  brand: {
    fontSize: 29,
    fontWeight: '800',
    color: '#473B38',
    letterSpacing: -0.7,
  },

  subtitle: {
    fontSize: 13,
    color: '#92827D',
    marginTop: 3,
  },

  bookCard: {
    width: '100%',
    maxWidth: 370,
    height: 355,
    backgroundColor: '#FFFDF9',
    borderRadius: 30,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',

    borderWidth: 1,
    borderColor: '#F0DDD5',

    shadowColor: '#A87B6E',
    shadowOffset: {
      width: 0,
      height: 7,
    },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 5,

    overflow: 'hidden',
  },

  cornerTopLeft: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#F8E9E3',
    top: -50,
    left: -45,
  },

  cornerTopRight: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#F5E1DC',
    top: -35,
    right: -30,
  },

  picture: {
    width: '100%',
    height: 285,
    alignItems: 'center',
    justifyContent: 'center',
  },

  handwritten: {
    position: 'absolute',
    bottom: 34,
    fontSize: 24,
    fontWeight: '600',
    fontStyle: 'italic',
    color: '#9B6266',
  },

  bookCaption: {
    position: 'absolute',
    bottom: 12,
    fontSize: 11,
    color: '#B09C96',
  },

  message: {
    alignItems: 'center',
    marginTop: 12,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#473B38',
  },

  titleAccent: {
    fontSize: 24,
    fontWeight: '700',
    color: '#B96B73',
    marginTop: -2,
  },

  description: {
    fontSize: 13.5,
    lineHeight: 19,
    color: '#887A75',
    textAlign: 'center',
    maxWidth: 350,
    marginTop: 7,
  },

  buttons: {
    width: '100%',
    maxWidth: 370,
    marginTop: 12,
    gap: 8,
  },

  primaryButton: {
    height: 49,
    borderRadius: 25,
    backgroundColor: '#C8757D',
    alignItems: 'center',
    justifyContent: 'center',

    shadowColor: '#9B5B63',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.16,
    shadowRadius: 7,
    elevation: 4,
  },

  primaryText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '700',
  },

  secondaryButton: {
    height: 45,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: '#DDB9B1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDF8F4',
  },

  secondaryText: {
    color: '#A7656D',
    fontSize: 15,
    fontWeight: '600',
  },

  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },

  footer: {
    fontSize: 10.5,
    color: '#B09F99',
    marginTop: 7,
    marginBottom: 2,
  },
});